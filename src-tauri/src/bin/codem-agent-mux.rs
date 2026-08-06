use codem::agent_mux_runtime::{
    allocate_port, generate_token, lock_path, probe_runtime, read_discovery, remove_discovery,
    resolve_app_data_dir, shutdown_runtime, write_discovery, RuntimeDiscovery, RUNTIME_TOKEN_ENV,
};
use reqwest::{Client, Response};
use serde_json::{json, Value};
use std::{
    env,
    ffi::{OsStr, OsString},
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::Duration,
};

#[cfg(not(target_os = "windows"))]
use std::process::Stdio;

#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;

#[cfg(target_os = "windows")]
use windows::{
    core::{PCWSTR, PWSTR},
    Win32::{
        Foundation::{CloseHandle, HANDLE},
        System::Threading::{
            CreateProcessW, TerminateProcess, CREATE_NEW_PROCESS_GROUP, CREATE_NO_WINDOW,
            CREATE_UNICODE_ENVIRONMENT, DETACHED_PROCESS, PROCESS_INFORMATION, STARTUPINFOW,
        },
    },
};

const PROVIDER_CODEX: &str = "openai-codex";
const PROVIDER_GROK: &str = "grok-build";
const PROVIDER_PI: &str = "pi-agent";
const PROVIDER_CLAUDE: &str = "claude-code";

struct RuntimeLock {
    path: PathBuf,
    _file: File,
}

impl Drop for RuntimeLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[cfg(target_os = "windows")]
struct RuntimeProcess {
    pid: u32,
    handle: HANDLE,
}

#[cfg(target_os = "windows")]
impl RuntimeProcess {
    fn id(&self) -> u32 {
        self.pid
    }

    fn kill(&mut self) {
        unsafe {
            let _ = TerminateProcess(self.handle, 1);
        }
    }
}

#[cfg(target_os = "windows")]
impl Drop for RuntimeProcess {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.handle);
        }
    }
}

#[cfg(not(target_os = "windows"))]
struct RuntimeProcess {
    child: std::process::Child,
}

#[cfg(not(target_os = "windows"))]
impl RuntimeProcess {
    fn id(&self) -> u32 {
        self.child.id()
    }

    fn kill(&mut self) {
        let _ = self.child.kill();
    }
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let command = args.first().map(String::as_str).unwrap_or("help");
    let app_data_dir = option(&args, "--app-data")
        .map(PathBuf::from)
        .unwrap_or_else(|| resolve_app_data_dir().unwrap_or_else(|error| exit_with_error(&error)));
    let result = if command == "serve" {
        serve(&args, &app_data_dir)
    } else {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap_or_else(|error| exit_with_error(&format!("启动 CLI 运行时失败: {error}")));
        runtime.block_on(run(args, app_data_dir))
    };
    if let Err(error) = result {
        eprintln!("codem-agent-mux: {error}");
        std::process::exit(1);
    }
}

fn exit_with_error(error: &str) -> ! {
    eprintln!("codem-agent-mux: {error}");
    std::process::exit(1)
}

async fn run(args: Vec<String>, app_data_dir: PathBuf) -> Result<(), String> {
    let command = args.first().map(String::as_str).unwrap_or("help");

    match command {
        "ensure" => {
            let discovery = ensure_runtime(&app_data_dir).await?;
            println!("{}", discovery.public_json());
            Ok(())
        }
        "agents" => {
            let api = ApiClient::connect(&app_data_dir).await?;
            let overview = api.get("/api/agent-mux/overview").await?;
            if args.iter().any(|arg| arg == "--json") {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&overview).map_err(|error| error.to_string())?
                );
            } else {
                print_agents(&overview);
            }
            Ok(())
        }
        "status" => {
            let discovery = read_live_discovery(&app_data_dir).await?;
            let api = ApiClient::from_discovery(&discovery)?;
            let overview = api.get("/api/agent-mux/overview").await?;
            println!(
                "{}",
                json!({
                    "runtime": discovery.public_json(),
                    "metrics": overview.get("metrics").cloned().unwrap_or(Value::Null),
                    "runs": overview.get("runs").cloned().unwrap_or(Value::Array(Vec::new())),
                })
            );
            Ok(())
        }
        "invoke" => invoke(&args, &app_data_dir).await,
        "cancel" => cancel(&args, &app_data_dir).await,
        "stop" => stop(&app_data_dir).await,
        _ => {
            print_help();
            Ok(())
        }
    }
}

fn serve(args: &[String], app_data_dir: &Path) -> Result<(), String> {
    let port = option(args, "--port")
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| "serve 缺少有效的 --port".to_string())?;
    env::set_var("CODEM_BACKEND_PORT", port.to_string());
    env::set_var("CODEM_APP_DATA_DIR", app_data_dir);
    codem::backend::run_from_env_blocking()
}

async fn ensure_runtime(app_data_dir: &Path) -> Result<RuntimeDiscovery, String> {
    if let Some(discovery) = read_discovery(app_data_dir) {
        if probe_runtime(&discovery) {
            return Ok(discovery);
        }
        let _ = shutdown_runtime(&discovery);
        remove_discovery(app_data_dir);
    }

    fs::create_dir_all(app_data_dir)
        .map_err(|error| format!("创建 Runtime 数据目录失败: {error}"))?;
    let runtime_lock_path = lock_path(app_data_dir);
    let lock = match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&runtime_lock_path)
    {
        Ok(mut file) => {
            let _ = writeln!(file, "{}", std::process::id());
            Some(RuntimeLock {
                path: runtime_lock_path.clone(),
                _file: file,
            })
        }
        Err(_) => None,
    };

    if lock.is_none() {
        for _ in 0..160 {
            if let Some(discovery) = read_discovery(app_data_dir) {
                if probe_runtime(&discovery) {
                    return Ok(discovery);
                }
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let _ = fs::remove_file(runtime_lock_path);
        return Box::pin(ensure_runtime(app_data_dir)).await;
    }

    let port = allocate_port()?;
    let token = generate_token();
    let executable = env::current_exe()
        .map_err(|error| format!("定位 codem-agent-mux 可执行文件失败: {error}"))?;
    let mut child = spawn_runtime_process(&executable, port, app_data_dir, &token)?;
    let discovery = RuntimeDiscovery::new(port, child.id(), token);
    let mut ready = false;
    for _ in 0..120 {
        if probe_runtime(&discovery) {
            ready = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    drop(lock);
    if !ready {
        child.kill();
        return Err("Agent Mux Runtime 启动超时".to_string());
    }
    write_discovery(app_data_dir, &discovery)?;
    Ok(discovery)
}

#[cfg(not(target_os = "windows"))]
fn spawn_runtime_process(
    executable: &Path,
    port: u16,
    app_data_dir: &Path,
    token: &str,
) -> Result<RuntimeProcess, String> {
    let child = std::process::Command::new(executable)
        .arg("serve")
        .arg("--port")
        .arg(port.to_string())
        .arg("--app-data")
        .arg(app_data_dir)
        .env(RUNTIME_TOKEN_ENV, token)
        .env("CODEM_BACKEND_PORT", port.to_string())
        .env("CODEM_APP_DATA_DIR", app_data_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("启动 Agent Mux Runtime 失败: {error}"))?;
    Ok(RuntimeProcess { child })
}

#[cfg(target_os = "windows")]
fn spawn_runtime_process(
    executable: &Path,
    port: u16,
    app_data_dir: &Path,
    token: &str,
) -> Result<RuntimeProcess, String> {
    let arguments = [
        executable.as_os_str().to_os_string(),
        OsString::from("serve"),
        OsString::from("--port"),
        OsString::from(port.to_string()),
        OsString::from("--app-data"),
        app_data_dir.as_os_str().to_os_string(),
    ];
    let mut command_line = windows_command_line(&arguments);
    let executable_wide = null_terminated_wide(executable.as_os_str());
    let port_value = OsString::from(port.to_string());
    let token_value = OsString::from(token);
    let environment = windows_environment_block(&[
        (OsStr::new(RUNTIME_TOKEN_ENV), token_value.as_os_str()),
        (OsStr::new("CODEM_BACKEND_PORT"), port_value.as_os_str()),
        (OsStr::new("CODEM_APP_DATA_DIR"), app_data_dir.as_os_str()),
    ]);
    let mut startup = STARTUPINFOW::default();
    startup.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
    let mut process = PROCESS_INFORMATION::default();
    let flags =
        DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT;
    unsafe {
        CreateProcessW(
            PCWSTR(executable_wide.as_ptr()),
            Some(PWSTR(command_line.as_mut_ptr())),
            None,
            None,
            false,
            flags,
            Some(environment.as_ptr().cast()),
            PCWSTR::null(),
            &startup,
            &mut process,
        )
        .map_err(|error| format!("启动 Agent Mux Runtime 失败: {error}"))?;
        let _ = CloseHandle(process.hThread);
    }
    Ok(RuntimeProcess {
        pid: process.dwProcessId,
        handle: process.hProcess,
    })
}

#[cfg(target_os = "windows")]
fn null_terminated_wide(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn windows_command_line(arguments: &[OsString]) -> Vec<u16> {
    let mut result = Vec::new();
    for (index, argument) in arguments.iter().enumerate() {
        if index > 0 {
            result.push(b' ' as u16);
        }
        result.extend(quote_windows_argument(argument));
    }
    result.push(0);
    result
}

#[cfg(target_os = "windows")]
fn quote_windows_argument(argument: &OsStr) -> Vec<u16> {
    let value = argument.encode_wide().collect::<Vec<_>>();
    if !value.is_empty()
        && !value
            .iter()
            .any(|unit| *unit == b' ' as u16 || *unit == b'\t' as u16 || *unit == b'"' as u16)
    {
        return value;
    }
    let mut result = vec![b'"' as u16];
    let mut backslashes = 0;
    for unit in value {
        if unit == b'\\' as u16 {
            backslashes += 1;
            continue;
        }
        if unit == b'"' as u16 {
            result.extend(std::iter::repeat_n(b'\\' as u16, backslashes * 2 + 1));
        } else {
            result.extend(std::iter::repeat_n(b'\\' as u16, backslashes));
        }
        backslashes = 0;
        result.push(unit);
    }
    result.extend(std::iter::repeat_n(b'\\' as u16, backslashes * 2));
    result.push(b'"' as u16);
    result
}

#[cfg(target_os = "windows")]
fn windows_environment_block(overrides: &[(&OsStr, &OsStr)]) -> Vec<u16> {
    windows_environment_block_from(env::vars_os().collect(), overrides)
}

#[cfg(target_os = "windows")]
fn windows_environment_block_from(
    mut variables: Vec<(OsString, OsString)>,
    overrides: &[(&OsStr, &OsStr)],
) -> Vec<u16> {
    for (name, value) in overrides {
        variables.retain(|(existing, _)| {
            !existing
                .to_string_lossy()
                .eq_ignore_ascii_case(&name.to_string_lossy())
        });
        variables.push((name.to_os_string(), value.to_os_string()));
    }
    variables.sort_by(|(left, _), (right, _)| {
        left.to_string_lossy()
            .to_ascii_lowercase()
            .cmp(&right.to_string_lossy().to_ascii_lowercase())
    });
    let mut result = Vec::new();
    for (name, value) in variables {
        let mut entry = name;
        entry.push("=");
        entry.push(value);
        result.extend(entry.encode_wide());
        result.push(0);
    }
    result.push(0);
    result
}

async fn read_live_discovery(app_data_dir: &Path) -> Result<RuntimeDiscovery, String> {
    if let Some(discovery) = read_discovery(app_data_dir) {
        if probe_runtime(&discovery) {
            return Ok(discovery);
        }
    }
    ensure_runtime(app_data_dir).await
}

async fn invoke(args: &[String], app_data_dir: &Path) -> Result<(), String> {
    let discovery = read_live_discovery(app_data_dir).await?;
    let api = ApiClient::from_discovery(&discovery)?;
    let overview = api.get("/api/agent-mux/overview").await?;
    let (agent, profile) = select_profile(&overview, option(args, "--profile").as_deref())?;
    let prompt = option(args, "--prompt").ok_or_else(|| "invoke 缺少 --prompt".to_string())?;
    let working_directory = option(args, "--working-directory").unwrap_or_else(|| ".".to_string());
    let permission_mode = option(args, "--permission").unwrap_or_else(|| "default".to_string());
    let caller = caller_label(args)?;
    let thread_id = optional_environment_value(env::var("CODEM_THREAD_ID").ok());
    let provider_id = provider_id(agent.get("id").and_then(Value::as_str).unwrap_or_default())
        .ok_or_else(|| "当前 Agent 暂不支持独立运行".to_string())?;
    let target = agent.get("name").and_then(Value::as_str).unwrap_or("Agent");
    let provider = profile
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or("Agent");
    let model = profile
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let reasoning_effort = profile.get("reasoningEffort").and_then(Value::as_str);
    let nickname = profile.get("nickname").and_then(Value::as_str);
    let avatar = profile.get("avatar").and_then(Value::as_str);
    let profile_id = profile
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let channel_id = profile
        .get("channelId")
        .and_then(Value::as_str)
        .filter(|value| *value != "system");
    let run = api
        .post(
            "/api/agent-mux/runs",
            json!({
                "caller": caller,
                "target": target,
                "profile": format!("{provider} / {model}"),
                "nickname": nickname,
                "avatar": avatar,
                "profileId": profile_id,
                "workingDirectory": working_directory,
                "threadId": thread_id,
                "skill": "codem-agent-mux",
                "status": "queued",
                "duration": "--",
                "started": "刚刚",
                "prompt": prompt.clone(),
                "summary": "",
            }),
        )
        .await?;
    let run_id = run
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "创建运行记录失败".to_string())?
        .to_string();
    api.patch(
        &format!("/api/agent-mux/runs/{run_id}"),
        json!({ "status": "running" }),
    )
    .await?;
    let response = api
        .raw_post(
            "/api/agents/run",
            json!({
                "providerId": provider_id,
                "channelId": channel_id,
                "prompt": prompt,
                "workingDirectory": working_directory,
                "model": model,
                "reasoningEffort": reasoning_effort,
                "permissionMode": permission_mode,
            }),
        )
        .await?;
    if !response.status().is_success() {
        let message = response
            .text()
            .await
            .unwrap_or_else(|_| "Agent 启动失败".to_string());
        let _ = api
            .patch(
                &format!("/api/agent-mux/runs/{run_id}"),
                json!({ "status": "failed", "summary": message.clone() }),
            )
            .await;
        return Err(message);
    }
    if let Some(provider_run_id) = response
        .headers()
        .get("X-CodeM-Agent-Run-Id")
        .and_then(|value| value.to_str().ok())
    {
        api.patch(
            &format!("/api/agent-mux/runs/{run_id}"),
            json!({ "providerRunId": provider_run_id }),
        )
        .await?;
    }
    let started_at = std::time::Instant::now();
    let mut stream = response;
    let mut buffer = String::new();
    let mut answer = String::new();
    let mut output_buffer = String::new();
    let mut status = "failed";
    let stream_result = async {
        let mut stop_reading = false;
        while let Some(chunk) = stream.chunk().await.map_err(|error| error.to_string())? {
            buffer.push_str(&String::from_utf8_lossy(&chunk));
            let mut lines = buffer.split('\n').map(str::to_string).collect::<Vec<_>>();
            buffer = lines.pop().unwrap_or_default();
            for line in lines {
                consume_event(
                    &api,
                    &run_id,
                    &line,
                    &mut answer,
                    &mut output_buffer,
                    &mut status,
                )
                .await?;
                if status == "waiting" {
                    stop_reading = true;
                    break;
                }
            }
            if stop_reading {
                break;
            }
        }
        if !stop_reading && !buffer.trim().is_empty() {
            consume_event(
                &api,
                &run_id,
                &buffer,
                &mut answer,
                &mut output_buffer,
                &mut status,
            )
            .await?;
        }
        flush_output(&api, &run_id, &mut output_buffer).await
    }
    .await;
    if let Err(error) = stream_result {
        let _ = flush_output(&api, &run_id, &mut output_buffer).await;
        let _ = api.event(&run_id, "error", &error).await;
        let _ = api
            .patch(
                &format!("/api/agent-mux/runs/{run_id}"),
                json!({
                    "status": "failed",
                    "duration": format_duration(started_at.elapsed()),
                    "summary": error.chars().take(500).collect::<String>(),
                }),
            )
            .await;
        return Err(error);
    }
    let summary = if answer.trim().is_empty() {
        match status {
            "waiting" => "等待用户处理".to_string(),
            "cancelled" => "任务已取消".to_string(),
            _ => "Agent 流未返回完成事件".to_string(),
        }
    } else {
        answer.trim().chars().take(500).collect()
    };
    let duration = format_duration(started_at.elapsed());
    api.patch(
        &format!("/api/agent-mux/runs/{run_id}"),
        json!({ "status": status, "duration": duration, "summary": summary }),
    )
    .await?;
    if !answer.is_empty() {
        println!();
    }
    Ok(())
}

fn optional_environment_value(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

async fn consume_event(
    api: &ApiClient,
    run_id: &str,
    line: &str,
    answer: &mut String,
    output_buffer: &mut String,
    status: &mut &str,
) -> Result<(), String> {
    if line.trim().is_empty() {
        return Ok(());
    }
    let event: Value =
        serde_json::from_str(line).map_err(|error| format!("Agent 事件解析失败: {error}"))?;
    let event_type = event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match event_type {
        "delta" => {
            if let Some(text) = event.get("text").and_then(Value::as_str) {
                answer.push_str(text);
                output_buffer.push_str(text);
                print!("{text}");
                let _ = std::io::stdout().flush();
                if output_buffer.len() >= 1000 {
                    flush_output(api, run_id, output_buffer).await?;
                }
            }
        }
        "status" | "phase" | "tool-start" => {
            flush_output(api, run_id, output_buffer).await?;
            let message = event
                .get("message")
                .or_else(|| event.get("label"))
                .or_else(|| event.get("name"))
                .and_then(Value::as_str)
                .unwrap_or(event_type);
            if !message.starts_with("Ignoring malformed agent role definition:") {
                let event_message = if event_type == "tool-start" {
                    format!("调用工具：{message}")
                } else {
                    message.to_string()
                };
                api.event(run_id, event_type, &event_message).await?;
            }
        }
        "approval-request" | "request-user-input" => {
            flush_output(api, run_id, output_buffer).await?;
            *status = "waiting";
            api.event(
                run_id,
                "waiting",
                if event_type == "approval-request" {
                    "等待权限确认"
                } else {
                    "等待用户输入"
                },
            )
            .await?;
        }
        "error" => {
            flush_output(api, run_id, output_buffer).await?;
            *status = "failed";
            api.event(
                run_id,
                "error",
                event
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("Agent 运行失败"),
            )
            .await?;
        }
        "done" => {
            if answer.is_empty() {
                if let Some(result) = event.get("result").and_then(Value::as_str) {
                    answer.push_str(result);
                    output_buffer.push_str(result);
                    print!("{result}");
                    let _ = std::io::stdout().flush();
                }
            }
            flush_output(api, run_id, output_buffer).await?;
            let reason = event
                .get("stopReason")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_ascii_lowercase();
            *status = if reason.contains("cancel") || reason.contains("interrupt") {
                "cancelled"
            } else {
                "completed"
            };
        }
        _ => {}
    }
    Ok(())
}

async fn flush_output(
    api: &ApiClient,
    run_id: &str,
    output_buffer: &mut String,
) -> Result<(), String> {
    if output_buffer.is_empty() {
        return Ok(());
    }
    let output = std::mem::take(output_buffer);
    api.event(run_id, "output", &output).await
}

async fn cancel(args: &[String], app_data_dir: &Path) -> Result<(), String> {
    let run_id = option(args, "--run").ok_or_else(|| "cancel 缺少 --run".to_string())?;
    let discovery = read_live_discovery(app_data_dir).await?;
    let api = ApiClient::from_discovery(&discovery)?;
    let runs = api.get("/api/agent-mux/runs").await?;
    let run = runs
        .as_array()
        .and_then(|items| {
            items
                .iter()
                .find(|item| item.get("id").and_then(Value::as_str) == Some(run_id.as_str()))
        })
        .ok_or_else(|| "运行记录不存在".to_string())?;
    let provider_run_id = run
        .get("providerRunId")
        .and_then(Value::as_str)
        .ok_or_else(|| "运行还没有底层 Agent ID".to_string())?;
    api.delete(&format!("/api/agents/run/{provider_run_id}"))
        .await?;
    api.event(&run_id, "cancelled", "用户取消了运行").await?;
    let final_run = api
        .patch(
            &format!("/api/agent-mux/runs/{run_id}"),
            json!({ "status": "cancelled", "summary": "任务已取消" }),
        )
        .await?;
    println!("{}", final_run);
    Ok(())
}

async fn stop(app_data_dir: &Path) -> Result<(), String> {
    let discovery = read_live_discovery(app_data_dir).await?;
    let api = ApiClient::from_discovery(&discovery)?;
    let _ = api.post("/api/runtime/shutdown", Value::Null).await?;
    for _ in 0..30 {
        if !probe_runtime(&discovery) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    remove_discovery(app_data_dir);
    println!("Runtime 已停止");
    Ok(())
}

fn select_profile<'a>(
    overview: &'a Value,
    requested: Option<&str>,
) -> Result<(&'a Value, &'a Value), String> {
    let agents = overview
        .get("agents")
        .and_then(Value::as_array)
        .ok_or_else(|| "Agent Mux 概览无效".to_string())?;
    for agent in agents {
        if let Some(profiles) = agent.get("profiles").and_then(Value::as_array) {
            for profile in profiles {
                let matches_requested = requested
                    .map(|id| profile.get("id").and_then(Value::as_str) == Some(id))
                    .unwrap_or(true);
                if matches_requested
                    && profile.get("status").and_then(Value::as_str) == Some("available")
                {
                    return Ok((agent, profile));
                }
            }
        }
    }
    Err(requested
        .map(|id| format!("可用 profile 不存在: {id}"))
        .unwrap_or_else(|| "没有可用的 Agent Mux profile".to_string()))
}

fn provider_id(agent_id: &str) -> Option<&'static str> {
    match agent_id {
        "codex" => Some(PROVIDER_CODEX),
        "grok" => Some(PROVIDER_GROK),
        "pi" => Some(PROVIDER_PI),
        "claude" => Some(PROVIDER_CLAUDE),
        _ => None,
    }
}

fn print_agents(overview: &Value) {
    if let Some(agents) = overview.get("agents").and_then(Value::as_array) {
        for agent in agents {
            let name = agent.get("name").and_then(Value::as_str).unwrap_or("Agent");
            let profiles = agent
                .get("profiles")
                .and_then(Value::as_array)
                .map(|items| items.len())
                .unwrap_or(0);
            println!("{name}\t{profiles} 个运行配置");
        }
    }
}

fn format_duration(duration: Duration) -> String {
    format!(
        "{:02}:{:02}",
        duration.as_secs() / 60,
        duration.as_secs() % 60
    )
}

fn option(args: &[String], name: &str) -> Option<String> {
    args.windows(2)
        .find(|items| items[0] == name)
        .map(|items| items[1].clone())
}

fn caller_label(args: &[String]) -> Result<String, String> {
    let caller = option(args, "--caller").unwrap_or_else(|| "外部调用".to_string());
    let caller = caller.trim();
    if caller.is_empty() {
        return Err("--caller 不能为空".to_string());
    }
    if caller.chars().count() > 64 {
        return Err("--caller 最多 64 个字符".to_string());
    }
    Ok(caller.to_string())
}

fn print_help() {
    println!("codem-agent-mux ensure|agents --json|invoke --prompt <text> [--profile <id>] [--caller <agent>] [--working-directory <path>] [--permission <mode>]|status --json|cancel --run <id>|stop");
}

struct ApiClient {
    client: Client,
    base: String,
    token: String,
}

impl ApiClient {
    async fn connect(app_data_dir: &Path) -> Result<Self, String> {
        let discovery = read_live_discovery(app_data_dir).await?;
        Self::from_discovery(&discovery)
    }

    fn from_discovery(discovery: &RuntimeDiscovery) -> Result<Self, String> {
        let client = Client::builder()
            .no_proxy()
            .build()
            .map_err(|error| error.to_string())?;
        Ok(Self {
            client,
            base: discovery.endpoint.clone(),
            token: discovery.token.clone(),
        })
    }

    async fn raw(&self, request: reqwest::RequestBuilder) -> Result<Response, String> {
        request
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(|error| error.to_string())
    }

    async fn get(&self, path: &str) -> Result<Value, String> {
        let response = self
            .raw(self.client.get(format!("{}{}", self.base, path)))
            .await?;
        self.read_json(response).await
    }

    async fn post(&self, path: &str, body: Value) -> Result<Value, String> {
        let response = self
            .raw(
                self.client
                    .post(format!("{}{}", self.base, path))
                    .json(&body),
            )
            .await?;
        self.read_json(response).await
    }

    async fn patch(&self, path: &str, body: Value) -> Result<Value, String> {
        let response = self
            .raw(
                self.client
                    .patch(format!("{}{}", self.base, path))
                    .json(&body),
            )
            .await?;
        self.read_json(response).await
    }

    async fn delete(&self, path: &str) -> Result<Value, String> {
        let response = self
            .raw(self.client.delete(format!("{}{}", self.base, path)))
            .await?;
        self.read_json(response).await
    }

    async fn event(&self, run_id: &str, event_type: &str, message: &str) -> Result<(), String> {
        self.post(
            &format!("/api/agent-mux/runs/{run_id}/events"),
            json!({ "eventType": event_type, "message": message }),
        )
        .await
        .map(|_| ())
    }

    async fn raw_post(&self, path: &str, body: Value) -> Result<Response, String> {
        self.raw(
            self.client
                .post(format!("{}{}", self.base, path))
                .json(&body),
        )
        .await
    }

    async fn read_json(&self, response: Response) -> Result<Value, String> {
        let status = response.status();
        let body = response.text().await.map_err(|error| error.to_string())?;
        if !status.is_success() {
            return Err(format!("Runtime 请求失败（{status}）: {body}"));
        }
        if body.trim().is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_str(&body).map_err(|error| format!("Runtime 返回数据无效: {error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caller_label_is_optional_but_validated() {
        assert_eq!(caller_label(&[]).unwrap(), "外部调用");
        assert_eq!(
            caller_label(&["--caller".into(), " OpenAI Codex ".into()]).unwrap(),
            "OpenAI Codex"
        );
        assert!(caller_label(&["--caller".into(), " ".into()]).is_err());
        assert!(caller_label(&["--caller".into(), "x".repeat(65)]).is_err());
    }

    #[test]
    fn inherited_thread_id_ignores_blank_values() {
        assert_eq!(
            optional_environment_value(Some(" thread-42 ".to_string())).as_deref(),
            Some("thread-42")
        );
        assert_eq!(optional_environment_value(Some("  ".to_string())), None);
        assert_eq!(optional_environment_value(None), None);
    }
}

#[cfg(all(test, target_os = "windows"))]
mod windows_tests {
    use super::*;

    fn wide_text(value: Vec<u16>) -> String {
        String::from_utf16(&value).expect("valid UTF-16")
    }

    fn environment_entries(block: &[u16]) -> Vec<String> {
        block[..block.len() - 1]
            .split(|unit| *unit == 0)
            .filter(|entry| !entry.is_empty())
            .map(|entry| String::from_utf16(entry).expect("valid UTF-16 environment entry"))
            .collect()
    }

    #[test]
    fn windows_arguments_follow_create_process_quoting_rules() {
        assert_eq!(
            wide_text(quote_windows_argument(OsStr::new("plain"))),
            "plain"
        );
        assert_eq!(wide_text(quote_windows_argument(OsStr::new(""))), "\"\"");
        assert_eq!(
            wide_text(quote_windows_argument(OsStr::new("two words"))),
            "\"two words\""
        );
        assert_eq!(
            wide_text(quote_windows_argument(OsStr::new("a\"b"))),
            "\"a\\\"b\""
        );
        assert_eq!(
            wide_text(quote_windows_argument(OsStr::new("C:\\path with space\\"))),
            "\"C:\\path with space\\\\\""
        );
    }

    #[test]
    fn windows_environment_block_overrides_case_insensitively_and_is_sorted() {
        let variables = vec![
            (OsString::from("zeta"), OsString::from("last")),
            (OsString::from("CodeM_Test"), OsString::from("old")),
            (OsString::from("Alpha"), OsString::from("first")),
        ];
        let block = windows_environment_block_from(
            variables,
            &[(OsStr::new("CODEM_TEST"), OsStr::new("new"))],
        );
        assert!(block.ends_with(&[0, 0]));
        assert_eq!(
            environment_entries(&block),
            vec!["Alpha=first", "CODEM_TEST=new", "zeta=last"]
        );
    }
}
