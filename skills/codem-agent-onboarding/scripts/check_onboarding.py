#!/usr/bin/env python3
import shutil
import subprocess
import sys
from pathlib import Path


TESTS = [
    "src/lib/agent-provider-onboarding-contract.test.ts",
    "src/lib/agent-provider-registry.test.ts",
    "src/lib/settings-api.test.ts",
    "src/lib/multi-provider-chat-routing.test.ts",
    "src/lib/markdown-link.test.ts",
    "src/lib/conversation-output-files.test.ts",
    "src/lib/conversation-context-prototype.test.ts",
    "src/lib/workspace-session-status.test.ts",
]


def run(repo: Path, command: list[str]) -> None:
    rtk = shutil.which("rtk")
    executable = shutil.which(command[0])
    if not executable:
        raise SystemExit(f"Required command not found: {command[0]}")
    resolved = [executable, *command[1:]]
    actual = [rtk, *resolved] if rtk else resolved
    print(f"\n> {' '.join(command)}", flush=True)
    subprocess.run(actual, cwd=repo, check=True)


def main() -> None:
    repo = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    required = [
        repo / "package.json",
        repo / "src-tauri" / "Cargo.toml",
        repo / "openspec" / "agent-provider-onboarding.md",
    ]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise SystemExit("Not a CodeM onboarding workspace; missing: " + ", ".join(missing))

    run(repo, ["node", "--import", "tsx", "--test", *TESTS])
    run(repo, ["npm", "run", "typecheck"])
    run(repo, ["cargo", "fmt", "--manifest-path", "src-tauri/Cargo.toml", "--check"])
    run(repo, ["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml", "agent_runtime::tests"])
    run(repo, ["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml", "automation::tests"])
    run(repo, ["npm", "run", "build"])
    print("\nCodeM Agent onboarding automated gate passed.")


if __name__ == "__main__":
    main()
