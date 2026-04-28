import argparse
import base64
import json
import os
import queue
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from typing import TextIO


@dataclass
class TurnResult:
    prompt: str
    result: str
    session_id: str
    raw_events: list[dict]
    tool_names: list[str]
    timed_out: bool = False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="测试 Claude Code stdin stream-json 对话方式是否可行")
    parser.add_argument(
        "prompts",
        nargs="*",
        help="要发送的提示词，支持连续传多个，表示同一 stdin 会话中的多轮对话",
    )
    parser.add_argument("--cwd", default=os.getcwd(), help="Claude 运行目录，默认当前目录")
    parser.add_argument("--resume", default="", help="复用已有 sessionId，避免新建会话")
    parser.add_argument("--model", default="", help="可选模型名")
    parser.add_argument(
        "--permission-mode",
        default="bypassPermissions",
        choices=["default", "plan", "acceptEdits", "auto", "dontAsk", "bypassPermissions"],
        help="权限模式，默认 bypassPermissions",
    )
    parser.add_argument("--claude-command", default=os.environ.get("CLAUDE_COMMAND", "claude"), help="Claude 可执行命令")
    parser.add_argument("--timeout-sec", type=float, default=120.0, help="每轮等待结果的超时时间")
    parser.add_argument("--image-path", default="", help="要测试的本地图片路径")
    parser.add_argument("--direct-image", action="store_true", help="把图片以 base64 直接内联到消息里，而不是传本地路径")
    parser.add_argument(
        "--prefer-zai-image",
        action="store_true",
        help="当传入 image-path 时，明确要求优先调用 zai-mcp-server 的 analyze_image 工具",
    )
    parser.add_argument("--disallowed-tools", default="", help="逗号分隔的禁用工具列表，原样传给 --disallowedTools")
    parser.add_argument("--print-raw", action="store_true", help="打印原始 JSON 行")
    return parser.parse_args()


def build_command(args: argparse.Namespace) -> list[str]:
    command = [args.claude_command, "-p", "", "--input-format", "stream-json"]
    command.extend(["--verbose", "--output-format", "stream-json", "--include-partial-messages"])
    if args.permission_mode == "bypassPermissions":
      command.append("--dangerously-skip-permissions")
    else:
      command.extend(["--permission-mode", args.permission_mode])
    if args.model.strip():
        command.extend(["--model", args.model.strip()])
    if args.resume.strip():
        command.extend(["--resume", args.resume.strip()])
    if args.disallowed_tools.strip():
        command.extend(["--disallowedTools", args.disallowed_tools.strip()])
    return command


def build_user_message(prompt: str, inline_image: dict | None = None) -> dict:
    content: list[dict] = [
        {
            "type": "text",
            "text": prompt,
        }
    ]
    if inline_image:
        content.append(inline_image)
    return {
        "type": "user",
        "message": {
            "role": "user",
            "content": content,
        },
    }


def build_image_prompt(image_path: str, prefer_zai_image: bool) -> str:
    lines = [
        "请读取这张本地图片里的主要文字内容，并用中文简短作答。",
        "",
        "图片路径：",
        f"- {image_path}",
        "",
    ]
    if prefer_zai_image:
        lines.extend([
            "如果当前会话可用，请优先调用 mcp__zai-mcp-server__analyze_image 处理这张图片。",
            "如果该工具不可用，再明确说明不可用，不要假装看过图片。",
        ])
    else:
        lines.extend([
            "如果当前会话有图片分析相关工具，请直接调用。",
            "如果没有图片工具，请明确说明不可用，不要猜测图片内容。",
        ])
    return "\n".join(lines)


def build_direct_image_prompt() -> str:
    return "请直接读取随附图片里的主要文字内容，并用中文简短作答。"


def build_inline_image_block(image_path: str) -> dict:
    media_type = guess_media_type(image_path)
    with open(image_path, "rb") as file:
        encoded = base64.b64encode(file.read()).decode("ascii")
    return {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": media_type,
            "data": encoded,
        },
    }


def guess_media_type(image_path: str) -> str:
    extension = os.path.splitext(image_path)[1].lower()
    if extension == ".png":
        return "image/png"
    if extension in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if extension == ".webp":
        return "image/webp"
    if extension == ".gif":
        return "image/gif"
    raise ValueError(f"不支持的图片格式：{image_path}")


def stream_reader(stream: TextIO, stream_name: str, sink: queue.Queue[tuple[str, str]]) -> None:
    for line in iter(stream.readline, ""):
        sink.put((stream_name, line.rstrip("\r\n")))
    sink.put((stream_name, "__EOF__"))


def run_turn(
    process: subprocess.Popen[str],
    event_queue: queue.Queue[tuple[str, str]],
    prompt: str,
    timeout_sec: float,
    print_raw: bool,
    last_session_id: str,
    inline_image: dict | None = None,
) -> TurnResult:
    payload = json.dumps(build_user_message(prompt, inline_image=inline_image), ensure_ascii=False)
    assert process.stdin is not None
    process.stdin.write(payload + "\n")
    process.stdin.flush()

    deadline = time.time() + timeout_sec
    raw_events: list[dict] = []
    result_text = ""
    session_id = last_session_id
    tool_names: list[str] = []
    assistant_snapshot_text = ""

    while time.time() < deadline:
        remaining = max(0.1, deadline - time.time())
        try:
            stream_name, line = event_queue.get(timeout=remaining)
        except queue.Empty:
            continue

        if stream_name == "stderr":
            if line and line != "__EOF__":
                print(f"[stderr] {line}")
            continue

        if line == "__EOF__":
            break
        if not line.strip():
            continue
        if print_raw:
            print(f"[stdout] {line}")

        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            print(f"[stdout-nonjson] {line}")
            continue

        raw_events.append(event)
        event_type = str(event.get("type", ""))
        event_session_id = str(event.get("session_id", "") or event.get("sessionId", ""))
        if event_session_id:
            session_id = event_session_id

        if event_type == "system" and event.get("subtype") == "init":
            tools = event.get("tools")
            if isinstance(tools, list):
                print(f"[init] tools={', '.join(str(item) for item in tools)}")
            continue

        next_tool_name = extract_tool_name(event)
        if next_tool_name and next_tool_name not in tool_names:
            tool_names.append(next_tool_name)
            print(f"[tool] {next_tool_name}")

        if event_type == "assistant":
            message = event.get("message")
            if isinstance(message, dict):
                content = message.get("content")
                if isinstance(content, list):
                    texts = [
                        str(block.get("text", ""))
                        for block in content
                        if isinstance(block, dict) and block.get("type") == "text"
                    ]
                    if texts:
                        assistant_snapshot_text = "".join(texts)
                        print("[assistant-snapshot]")
                        print(assistant_snapshot_text)
            continue

        if event_type == "result":
            result_text = str(event.get("result", ""))
            print("[result]")
            print(result_text or "(empty)")
            return TurnResult(
                prompt=prompt,
                result=result_text,
                session_id=session_id,
                raw_events=raw_events,
                tool_names=tool_names,
            )

    timeout_message = f"[TIMEOUT after {timeout_sec:.1f}s]"
    if assistant_snapshot_text.strip():
        timeout_message = f"{timeout_message}\n{assistant_snapshot_text.strip()}"
    print("[timeout]")
    print(timeout_message)
    return TurnResult(
        prompt=prompt,
        result=timeout_message,
        session_id=session_id,
        raw_events=raw_events,
        tool_names=tool_names,
        timed_out=True,
    )


def main() -> int:
    args = parse_args()
    prompts = [prompt for prompt in args.prompts if prompt.strip()]
    inline_image = None
    if not prompts:
        if args.image_path.strip():
            if args.direct_image:
                prompts = [build_direct_image_prompt()]
                inline_image = build_inline_image_block(args.image_path.strip())
            else:
                prompts = [build_image_prompt(args.image_path.strip(), args.prefer_zai_image)]
        else:
            prompts = ["只回复一个字：好"]

    command = build_command(args)
    print("[command]")
    print(" ".join(command))
    print(f"[cwd] {args.cwd}")
    if args.resume.strip():
        print(f"[resume] {args.resume.strip()}")

    process = subprocess.Popen(
        command,
        cwd=args.cwd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )

    assert process.stdout is not None
    assert process.stderr is not None
    event_queue: queue.Queue[tuple[str, str]] = queue.Queue()
    stdout_thread = threading.Thread(target=stream_reader, args=(process.stdout, "stdout", event_queue), daemon=True)
    stderr_thread = threading.Thread(target=stream_reader, args=(process.stderr, "stderr", event_queue), daemon=True)
    stdout_thread.start()
    stderr_thread.start()

    turn_results: list[TurnResult] = []
    session_id = args.resume.strip()

    try:
        for index, prompt in enumerate(prompts, start=1):
            print(f"\n[turn {index}] {prompt}")
            turn_result = run_turn(
                process,
                event_queue,
                prompt,
                args.timeout_sec,
                args.print_raw,
                session_id,
                inline_image=inline_image if index == 1 else None,
            )
            turn_results.append(turn_result)
            if turn_result.session_id:
                session_id = turn_result.session_id
                print(f"[session] {session_id}")
    finally:
        if process.stdin:
            process.stdin.close()
        try:
            process.terminate()
            process.wait(timeout=5)
        except Exception:
            process.kill()

    print("\n[summary]")
    print(json.dumps(
        {
            "ok": True,
            "hasTimeout": any(item.timed_out for item in turn_results),
            "turns": [
                {
                    "prompt": item.prompt,
                    "result": item.result,
                    "sessionId": item.session_id,
                    "tools": item.tool_names,
                    "timedOut": item.timed_out,
                }
                for item in turn_results
            ],
        },
        ensure_ascii=False,
        indent=2,
    ))
    return 0


def extract_tool_name(event: dict) -> str:
    event_type = str(event.get("type", ""))
    if event_type == "assistant":
        message = event.get("message")
        if isinstance(message, dict):
            content = message.get("content")
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "tool_use":
                        name = str(block.get("name", "")).strip()
                        if name:
                            return name

    if event_type != "stream_event":
        return ""

    inner_event = event.get("event")
    if not isinstance(inner_event, dict):
        return ""

    content_block = inner_event.get("content_block")
    if not isinstance(content_block, dict):
        return ""

    if content_block.get("type") != "tool_use":
        return ""

    return str(content_block.get("name", "")).strip()


if __name__ == "__main__":
    sys.exit(main())
