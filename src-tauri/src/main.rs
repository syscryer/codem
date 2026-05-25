#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WindowEvent};

#[cfg(not(windows))]
use std::process::{Command, Stdio};

const DEFAULT_WINDOW_MATERIAL_ID: i32 = 2;
const WINDOW_STATE_FILE_NAME: &str = "window-state.json";
const DESKTOP_LOG_FILE_NAME: &str = "desktop.log";
const BACKEND_LOG_FILE_NAME: &str = "backend.log";
const MIN_WINDOW_WIDTH: u32 = 960;
const MIN_WINDOW_HEIGHT: u32 = 640;
#[cfg(target_os = "windows")]
const POWERSHELL_7_PATH: &str = r"C:\Program Files\PowerShell\7\pwsh.exe";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowMaterial {
    id: i32,
    name: &'static str,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowState {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct MonitorWorkArea {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PtyEnsureRequest {
    terminal_tab_id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PtyInputRequest {
    terminal_tab_id: String,
    data: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PtyResizeRequest {
    terminal_tab_id: String,
    cols: u16,
    rows: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyOutputEvent {
    terminal_tab_id: String,
    data: String,
    stream: String,
}

type SharedPtyWriter = Arc<Mutex<Box<dyn Write + Send>>>;

struct PtySession {
    writer: SharedPtyWriter,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send>,
}

#[derive(Default)]
struct PtySessions {
    sessions: Mutex<HashMap<String, PtySession>>,
}

#[derive(Default)]
struct BackendPortState {
    port: Mutex<u16>,
}

#[derive(Clone, Copy)]
struct BackendStartupTarget {
    port: u16,
    reuse_existing: bool,
}

#[cfg(windows)]
struct BackendPtyProcess {
    _master: Box<dyn MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[cfg(windows)]
#[derive(Default)]
struct BackendPtyProcesses {
    process: Mutex<Option<BackendPtyProcess>>,
}

#[cfg(windows)]
impl Drop for BackendPtyProcesses {
    fn drop(&mut self) {
        if let Ok(process) = self.process.get_mut() {
            if let Some(process) = process.as_mut() {
                let _ = process.child.kill();
                let _ = process.child.wait();
            }
        }
    }
}

#[tauri::command]
fn get_supported_window_materials() -> Vec<WindowMaterial> {
    platform::supported_window_materials()
}

#[tauri::command]
fn get_current_window_material(app: tauri::AppHandle) -> Result<WindowMaterial, String> {
    platform::current_window_material(&app)
}

#[tauri::command]
fn set_window_material(app: tauri::AppHandle, material: i32) -> Result<WindowMaterial, String> {
    platform::set_window_material(&app, material)
}

#[tauri::command]
fn ensure_pty_session(
    app: AppHandle,
    store: State<'_, PtySessions>,
    request: PtyEnsureRequest,
) -> Result<(), String> {
    let mut sessions = store.sessions.lock().map_err(|error| error.to_string())?;
    if let Some(existing) = sessions.get_mut(&request.terminal_tab_id) {
        existing
            .master
            .resize(pty_size(request.cols, request.rows))
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(pty_size(request.cols, request.rows))
        .map_err(|error| error.to_string())?;

    let mut command = terminal_command();
    if let Some(cwd) = request.cwd.as_ref().and_then(valid_directory) {
        command.cwd(cwd);
    }

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| error.to_string())?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| error.to_string())?;
    let terminal_tab_id = request.terminal_tab_id.clone();
    let app_handle = app.clone();

    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    emit_pty_output(
                        &app_handle,
                        &terminal_tab_id,
                        "\r\n[process exited]\r\n".to_string(),
                        "exit",
                    );
                    break;
                }
                Ok(read) => {
                    let data = String::from_utf8_lossy(&buffer[..read]).to_string();
                    emit_pty_output(&app_handle, &terminal_tab_id, data, "stdout");
                }
                Err(error) => {
                    emit_pty_output(
                        &app_handle,
                        &terminal_tab_id,
                        format!("\r\n[pty read error: {error}]\r\n"),
                        "stderr",
                    );
                    break;
                }
            }
        }
    });

    sessions.insert(
        request.terminal_tab_id,
        PtySession {
            writer: Arc::new(Mutex::new(writer)),
            master: pair.master,
            child,
        },
    );
    Ok(())
}

#[tauri::command]
fn write_pty_input(store: State<'_, PtySessions>, request: PtyInputRequest) -> Result<(), String> {
    let sessions = store.sessions.lock().map_err(|error| error.to_string())?;
    let session = sessions
        .get(&request.terminal_tab_id)
        .ok_or_else(|| "PTY session not found".to_string())?;
    let mut writer = session.writer.lock().map_err(|error| error.to_string())?;
    writer
        .write_all(request.data.as_bytes())
        .and_then(|_| writer.flush())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn resize_pty_session(
    store: State<'_, PtySessions>,
    request: PtyResizeRequest,
) -> Result<(), String> {
    let mut sessions = store.sessions.lock().map_err(|error| error.to_string())?;
    let session = sessions
        .get_mut(&request.terminal_tab_id)
        .ok_or_else(|| "PTY session not found".to_string())?;
    session
        .master
        .resize(pty_size(request.cols, request.rows))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn close_pty_session(store: State<'_, PtySessions>, terminal_tab_id: String) -> Result<(), String> {
    let mut sessions = store.sessions.lock().map_err(|error| error.to_string())?;
    if let Some(mut session) = sessions.remove(&terminal_tab_id) {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    Ok(())
}

#[tauri::command]
fn pick_directory(initial_path: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new();

    if let Some(initial_path) = initial_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let resolved_path = PathBuf::from(initial_path);
        let directory = if resolved_path.is_dir() {
            Some(resolved_path)
        } else {
            resolved_path.parent().map(Path::to_path_buf)
        };

        if let Some(directory) = directory.filter(|value| value.is_dir()) {
            dialog = dialog.set_directory(directory);
        }
    }

    Ok(dialog
        .pick_folder()
        .map(|selected_path| selected_path.display().to_string()))
}

#[tauri::command]
fn get_backend_base_url(state: State<'_, BackendPortState>) -> Result<String, String> {
    let port = *state.port.lock().map_err(|error| error.to_string())?;
    Ok(format!("http://127.0.0.1:{port}"))
}

fn main() {
    let builder = tauri::Builder::default()
        .manage(PtySessions::default())
        .manage(BackendPortState {
            port: Mutex::new(3001),
        });
    #[cfg(windows)]
    let builder = builder.manage(BackendPtyProcesses::default());

    builder
        .setup(|app| {
            let app_handle = app.handle().clone();
            restore_main_window_state(&app_handle);
            focus_main_window(&app_handle);
            let _ = platform::set_window_material(&app_handle, DEFAULT_WINDOW_MATERIAL_ID);
            #[cfg(windows)]
            let backend_processes = app.state::<BackendPtyProcesses>();

            #[cfg(windows)]
            let startup_result = ensure_backend_started(&app_handle, &backend_processes);
            #[cfg(not(windows))]
            let startup_result = ensure_backend_started(&app_handle);

            match startup_result {
                Ok(()) => log_desktop_event(&app_handle, "backend start check completed"),
                Err(error) => {
                    log_desktop_event(&app_handle, &format!("backend start failed: {error}"))
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, WindowEvent::CloseRequested { .. }) {
                let _ = save_window_state(window);
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_supported_window_materials,
            get_current_window_material,
            set_window_material,
            ensure_pty_session,
            write_pty_input,
            resize_pty_session,
            close_pty_session,
            pick_directory,
            get_backend_base_url
        ])
        .run(tauri::generate_context!())
        .expect("failed to run CodeM desktop shell");
}

fn pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn terminal_command() -> CommandBuilder {
    let shell = terminal_shell_path();
    let mut command = CommandBuilder::new(shell.clone());
    for arg in interactive_terminal_args(&shell) {
        command.arg(arg);
    }
    command
}

fn terminal_shell_path() -> String {
    #[cfg(target_os = "windows")]
    {
        if Path::new(POWERSHELL_7_PATH).exists() {
            return POWERSHELL_7_PATH.to_string();
        }
        "powershell.exe".to_string()
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(shell) = std::env::var("SHELL") {
            if Path::new(&shell).exists() {
                return shell;
            }
        }
        if Path::new("/bin/bash").exists() {
            "/bin/bash".to_string()
        } else {
            "/bin/sh".to_string()
        }
    }
}

fn interactive_terminal_args(shell_path: &str) -> Vec<String> {
    let shell_name = Path::new(shell_path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(shell_path)
        .to_ascii_lowercase();

    #[cfg(target_os = "windows")]
    {
        if shell_name == "cmd.exe" || shell_name == "cmd" {
            return Vec::new();
        }
        vec!["-NoLogo".to_string(), "-NoProfile".to_string()]
    }

    #[cfg(not(target_os = "windows"))]
    {
        match shell_name.as_str() {
            "bash" | "zsh" => vec!["-l".to_string()],
            _ => Vec::new(),
        }
    }
}

fn valid_directory(value: &String) -> Option<PathBuf> {
    let path = PathBuf::from(value);
    path.is_dir().then_some(path)
}

fn emit_pty_output(app: &AppHandle, terminal_tab_id: &str, data: String, stream: &str) {
    if data.is_empty() {
        return;
    }

    let _ = app.emit(
        "pty-output",
        PtyOutputEvent {
            terminal_tab_id: terminal_tab_id.to_string(),
            data,
            stream: stream.to_string(),
        },
    );
}

fn restore_main_window_state(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let Some(state) = load_window_state(app) else {
        return;
    };

    let work_areas = read_monitor_work_areas(window.available_monitors());
    let Some(normalized_state) = normalize_window_state(state, &work_areas) else {
        return;
    };

    let _ = window.set_size(PhysicalSize::new(
        normalized_state.width,
        normalized_state.height,
    ));
    let _ = window.set_position(PhysicalPosition::new(normalized_state.x, normalized_state.y));
    if normalized_state != state {
        let _ = persist_window_state(app, normalized_state);
    }
}

fn focus_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

fn load_window_state(app: &tauri::AppHandle) -> Option<WindowState> {
    let path = window_state_path(app).ok()?;
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn save_window_state(window: &tauri::Window) -> Result<(), String> {
    if window.is_minimized().unwrap_or(false) || window.is_maximized().unwrap_or(false) {
        return Ok(());
    }

    let position = window
        .outer_position()
        .map_err(|error| format!("读取窗口位置失败: {error}"))?;
    let size = window
        .inner_size()
        .map_err(|error| format!("读取窗口尺寸失败: {error}"))?;

    let state = WindowState {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };

    let Some(state_to_save) = prepare_window_state_for_save(state) else {
        return Ok(());
    };

    persist_window_state(window.app_handle(), state_to_save)
}

fn persist_window_state(app: &tauri::AppHandle, state: WindowState) -> Result<(), String> {
    let path = window_state_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建窗口配置目录失败: {error}"))?;
    }

    let content = serde_json::to_string_pretty(&state)
        .map_err(|error| format!("序列化窗口配置失败: {error}"))?;
    fs::write(path, content).map_err(|error| format!("保存窗口配置失败: {error}"))
}

fn window_state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(WINDOW_STATE_FILE_NAME))
        .map_err(|error| format!("读取应用配置目录失败: {error}"))
}

fn read_monitor_work_areas(
    monitors_result: Result<Vec<tauri::Monitor>, tauri::Error>,
) -> Vec<MonitorWorkArea> {
    let Ok(monitors) = monitors_result else {
        return Vec::new();
    };

    monitors
        .into_iter()
        .map(|monitor| {
            let area = monitor.work_area();
            MonitorWorkArea {
                x: area.position.x,
                y: area.position.y,
                width: area.size.width as i32,
                height: area.size.height as i32,
            }
        })
        .collect()
}

fn normalize_window_state(state: WindowState, work_areas: &[MonitorWorkArea]) -> Option<WindowState> {
    if state.width < MIN_WINDOW_WIDTH || state.height < MIN_WINDOW_HEIGHT {
        return None;
    }

    if work_areas.is_empty() {
        return Some(state);
    }

    work_areas
        .iter()
        .find(|area| {
            rects_intersect(
                state.x,
                state.y,
                state.width as i32,
                state.height as i32,
                area.x,
                area.y,
                area.width,
                area.height,
            )
        })
        .map(|area| clamp_window_state_to_area(state, *area))
}

fn prepare_window_state_for_save(state: WindowState) -> Option<WindowState> {
    has_minimum_window_size(state).then_some(state)
}

fn has_minimum_window_size(state: WindowState) -> bool {
    state.width >= MIN_WINDOW_WIDTH && state.height >= MIN_WINDOW_HEIGHT
}

fn clamp_window_state_to_area(state: WindowState, area: MonitorWorkArea) -> WindowState {
    let max_width = area.width.max(MIN_WINDOW_WIDTH as i32) as u32;
    let max_height = area.height.max(MIN_WINDOW_HEIGHT as i32) as u32;
    let width = state.width.min(max_width);
    let height = state.height.min(max_height);
    let max_x = area.x.saturating_add(area.width.saturating_sub(width as i32));
    let max_y = area.y.saturating_add(area.height.saturating_sub(height as i32));
    let x = state.x.clamp(area.x, max_x);
    let y = state.y.clamp(area.y, max_y);

    WindowState { x, y, width, height }
}

fn rects_intersect(
    left_a: i32,
    top_a: i32,
    width_a: i32,
    height_a: i32,
    left_b: i32,
    top_b: i32,
    width_b: i32,
    height_b: i32,
) -> bool {
    let right_a = left_a.saturating_add(width_a);
    let bottom_a = top_a.saturating_add(height_a);
    let right_b = left_b.saturating_add(width_b);
    let bottom_b = top_b.saturating_add(height_b);

    left_a < right_b && right_a > left_b && top_a < bottom_b && bottom_a > top_b
}

#[cfg(windows)]
fn ensure_backend_started(
    app: &tauri::AppHandle,
    backend_processes: &BackendPtyProcesses,
) -> Result<(), String> {
    let target = resolve_backend_startup_target(app)?;
    if target.reuse_existing {
        return Ok(());
    }
    ensure_backend_started_impl(app, Some(backend_processes), target.port)
}

#[cfg(not(windows))]
fn ensure_backend_started(app: &tauri::AppHandle) -> Result<(), String> {
    let target = resolve_backend_startup_target(app)?;
    if target.reuse_existing {
        return Ok(());
    }
    ensure_backend_started_impl(app, target.port)
}

#[cfg(windows)]
fn ensure_backend_started_impl(
    app: &tauri::AppHandle,
    backend_processes: Option<&BackendPtyProcesses>,
    backend_port: u16,
) -> Result<(), String> {
    ensure_backend_started_with_launcher(app, backend_processes, backend_port)
}

#[cfg(not(windows))]
fn ensure_backend_started_impl(app: &tauri::AppHandle, backend_port: u16) -> Result<(), String> {
    ensure_backend_started_with_launcher(app, backend_port)
}

#[cfg(windows)]
fn ensure_backend_started_with_launcher(
    app: &tauri::AppHandle,
    backend_processes: Option<&BackendPtyProcesses>,
    backend_port: u16,
) -> Result<(), String> {
    let backend_processes = backend_processes
        .ok_or_else(|| "missing backend process state".to_string())?;

    if let Some(server_entry) = find_packaged_backend_entry(app) {
        return start_node_backend_process(app, backend_processes, backend_port, &server_entry);
    }

    if let Some(server_entry) = find_development_backend_entry() {
        return start_node_backend_process(app, backend_processes, backend_port, &server_entry);
    }

    let project_root =
        find_project_root().ok_or_else(|| "CodeM project directory not found".to_string())?;
    start_development_backend_process(app, backend_processes, backend_port, &project_root)
}

#[cfg(not(windows))]
fn ensure_backend_started_with_launcher(app: &tauri::AppHandle, backend_port: u16) -> Result<(), String> {
    if let Some(server_entry) = find_packaged_backend_entry(app) {
        return start_node_backend_process(app, backend_port, &server_entry);
    }

    if let Some(server_entry) = find_development_backend_entry() {
        return start_node_backend_process(app, backend_port, &server_entry);
    }

    let project_root =
        find_project_root().ok_or_else(|| "CodeM project directory not found".to_string())?;
    start_development_backend_process(app, backend_port, &project_root)
}

fn is_backend_ready(port: u16) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&address, Duration::from_millis(240)).is_ok()
}

fn resolve_backend_startup_target(app: &tauri::AppHandle) -> Result<BackendStartupTarget, String> {
    if let Some(port) = configured_backend_port() {
        set_backend_port(app, port)?;
        if is_backend_ready(port) {
            log_desktop_event(app, &format!("reusing existing backend port: {port}"));
            return Ok(BackendStartupTarget {
                port,
                reuse_existing: true,
            });
        }

        log_desktop_event(
            app,
            &format!("configured backend port not ready, starting backend: {port}"),
        );
        return Ok(BackendStartupTarget {
            port,
            reuse_existing: false,
        });
    }

    let port = allocate_backend_port()?;
    set_backend_port(app, port)?;
    Ok(BackendStartupTarget {
        port,
        reuse_existing: false,
    })
}

fn configured_backend_port() -> Option<u16> {
    resolve_backend_port_from_value(std::env::var("CODEM_BACKEND_PORT").ok().as_deref())
}

fn resolve_backend_port_from_value(value: Option<&str>) -> Option<u16> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port > 0)
}

fn allocate_backend_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("分配 CodeM 后端端口失败: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("读取 CodeM 后端端口失败: {error}"))?
        .port();
    drop(listener);
    Ok(port)
}

fn set_backend_port(app: &tauri::AppHandle, port: u16) -> Result<(), String> {
    let state = app.state::<BackendPortState>();
    let mut current = state.port.lock().map_err(|error| error.to_string())?;
    *current = port;
    log_desktop_event(app, &format!("selected backend port: {port}"));
    Ok(())
}

fn find_project_root() -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir);
    }

    if let Ok(current_exe) = std::env::current_exe() {
        for ancestor in current_exe.ancestors() {
            candidates.push(ancestor.to_path_buf());
        }
    }

    candidates.into_iter().find_map(find_project_root_from)
}

fn find_project_root_from(start: PathBuf) -> Option<PathBuf> {
    for ancestor in start.ancestors() {
        if has_project_manifest(ancestor) {
            return Some(ancestor.to_path_buf());
        }
    }

    None
}

fn has_project_manifest(path: &Path) -> bool {
    let package_json = path.join("package.json");
    let server_entry = path.join("server").join("index.ts");
    fs::metadata(package_json).is_ok() && fs::metadata(server_entry).is_ok()
}

fn find_packaged_backend_entry(app: &tauri::AppHandle) -> Option<PathBuf> {
    let resource_dir = match app.path().resource_dir() {
        Ok(directory) => directory,
        Err(error) => {
            log_desktop_event(app, &format!("resource_dir error: {error}"));
            return None;
        }
    };

    let candidates = [
        resource_dir.join("dist-server").join("index.mjs"),
        resource_dir
            .join("_up_")
            .join("dist-server")
            .join("index.mjs"),
    ];

    for entry in candidates {
        log_desktop_event(app, &format!("check packaged backend: {}", entry.display()));
        if fs::metadata(&entry).is_ok() {
            log_desktop_event(app, &format!("packaged backend found: {}", entry.display()));
            return Some(entry);
        }
    }

    None
}

fn find_development_backend_entry() -> Option<PathBuf> {
    find_project_root()
        .map(|root| root.join("dist-server").join("index.mjs"))
        .filter(|entry| fs::metadata(entry).is_ok())
}

#[cfg(windows)]
fn start_node_backend_process(
    app: &tauri::AppHandle,
    backend_processes: &BackendPtyProcesses,
    backend_port: u16,
    server_entry: &Path,
) -> Result<(), String> {
    let cwd = normalize_process_path(
        &server_entry
            .parent()
            .and_then(Path::parent)
            .unwrap_or_else(|| Path::new(".")),
    );
    let server_entry = normalize_process_path(server_entry);
    let node_runtime = node_backend_executable(&server_entry);
    log_desktop_event(
        app,
        &format!(
            "start node backend via pty: node={}, entry={}, cwd={}",
            node_runtime.display(),
            server_entry.display(),
            cwd.display()
        ),
    );

    let mut command = CommandBuilder::new(node_runtime.as_os_str());
    command.arg("--experimental-sqlite");
    command.arg(server_entry.as_os_str());
    command.cwd(cwd.as_os_str());
    command.env("NODE_ENV", "production");
    command.env("PORT", backend_port.to_string());

    start_backend_pty_process(app, backend_processes, backend_port, command, "node backend")
}

#[cfg(not(windows))]
fn start_node_backend_process(
    app: &tauri::AppHandle,
    backend_port: u16,
    server_entry: &Path,
) -> Result<(), String> {
    let cwd = normalize_process_path(
        &server_entry
            .parent()
            .and_then(Path::parent)
            .unwrap_or_else(|| Path::new(".")),
    );
    let server_entry = normalize_process_path(server_entry);
    let node_runtime = node_backend_executable(&server_entry);
    log_desktop_event(
        app,
        &format!(
            "start node backend: node={}, entry={}, cwd={}",
            node_runtime.display(),
            server_entry.display(),
            cwd.display()
        ),
    );
    let mut command = node_backend_command(&server_entry);
    let (stdout, stderr) = backend_log_stdio(app);
    command
        .current_dir(&cwd)
        .env("NODE_ENV", "production")
        .env("PORT", backend_port.to_string())
        .stdin(Stdio::null())
        .stdout(stdout)
        .stderr(stderr);

    platform::prepare_hidden_background_command(&mut command);

    match command.spawn() {
        Ok(child) => {
            log_desktop_event(app, &format!("node backend spawned: pid={}", child.id()));
            wait_for_backend_ready(app, backend_port)
        }
        Err(error) => {
            log_desktop_event(app, &format!("node backend spawn error: {error}"));
            Err(format!("启动 CodeM 后端失败: {error}"))
        }
    }
}

fn normalize_process_path(path: &Path) -> PathBuf {
    let value = path.to_string_lossy();

    #[cfg(windows)]
    {
        if let Some(stripped) = value.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{stripped}"));
        }

        if let Some(stripped) = value.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped);
        }
    }

    PathBuf::from(value.as_ref())
}

#[cfg(windows)]
fn start_development_backend_process(
    app: &tauri::AppHandle,
    backend_processes: &BackendPtyProcesses,
    backend_port: u16,
    project_root: &Path,
) -> Result<(), String> {
    let project_root = normalize_process_path(project_root);
    log_desktop_event(
        app,
        &format!("start development backend: cwd={}", project_root.display()),
    );
    let mut command = CommandBuilder::new("cmd.exe");
    command.args(["/D", "/S", "/C", "npm run dev:server"]);
    command.cwd(project_root.as_os_str());
    command.env("PORT", backend_port.to_string());
    start_backend_pty_process(app, backend_processes, backend_port, command, "development backend")
}

#[cfg(not(windows))]
fn start_development_backend_process(
    app: &tauri::AppHandle,
    backend_port: u16,
    project_root: &Path,
) -> Result<(), String> {
    let project_root = normalize_process_path(project_root);
    log_desktop_event(
        app,
        &format!("start development backend: cwd={}", project_root.display()),
    );
    let mut command = development_backend_command();
    let (stdout, stderr) = backend_log_stdio(app);
    command
        .current_dir(&project_root)
        .env("PORT", backend_port.to_string())
        .stdin(Stdio::null())
        .stdout(stdout)
        .stderr(stderr);

    platform::prepare_hidden_background_command(&mut command);

    match command.spawn() {
        Ok(child) => {
            log_desktop_event(
                app,
                &format!("development backend spawned: pid={}", child.id()),
            );
            wait_for_backend_ready(app, backend_port)
        }
        Err(error) => {
            log_desktop_event(app, &format!("development backend spawn error: {error}"));
            Err(format!("启动 CodeM 后端失败: {error}"))
        }
    }
}

#[cfg(not(windows))]
fn node_backend_command(server_entry: &Path) -> Command {
    let mut command = Command::new(node_backend_executable(server_entry));
    command.arg("--experimental-sqlite").arg(server_entry);
    command
}

fn node_backend_executable(server_entry: &Path) -> PathBuf {
    find_packaged_node_runtime(server_entry).unwrap_or_else(|| PathBuf::from("node"))
}

fn find_packaged_node_runtime(server_entry: &Path) -> Option<PathBuf> {
    let dist_server_dir = server_entry.parent()?;
    let runtime_dir = dist_server_dir.join("runtime");

    #[cfg(windows)]
    let runtime = runtime_dir.join("node.exe");

    #[cfg(not(windows))]
    let runtime = runtime_dir.join("node");

    fs::metadata(&runtime).is_ok().then_some(runtime)
}

fn app_logs_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("logs"))
        .map_err(|error| format!("读取日志目录失败: {error}"))
}

fn desktop_log_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app_logs_dir(app).map(|directory| directory.join(DESKTOP_LOG_FILE_NAME))
}

fn backend_log_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app_logs_dir(app).map(|directory| directory.join(BACKEND_LOG_FILE_NAME))
}

fn log_desktop_event(app: &tauri::AppHandle, message: &str) {
    if let Ok(path) = desktop_log_path(app) {
        append_log_line(&path, message);
    }
}

#[cfg(not(windows))]
fn backend_log_stdio(app: &tauri::AppHandle) -> (Stdio, Stdio) {
    let Ok(path) = backend_log_path(app) else {
        return (Stdio::null(), Stdio::null());
    };

    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(file) => match file.try_clone() {
            Ok(stderr_file) => (Stdio::from(file), Stdio::from(stderr_file)),
            Err(error) => {
                append_log_line(&path, &format!("复制后端日志句柄失败: {error}"));
                (Stdio::from(file), Stdio::null())
            }
        },
        Err(_) => (Stdio::null(), Stdio::null()),
    }
}

fn append_log_line(path: &Path, message: &str) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "[{}] {}", current_timestamp_ms(), message);
    }
}

fn append_log_chunk(path: &Path, chunk: &str) {
    if chunk.is_empty() {
        return;
    }

    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = file.write_all(chunk.as_bytes());
    }
}

fn wait_for_backend_ready(app: &tauri::AppHandle, port: u16) -> Result<(), String> {
    let timeout = Duration::from_secs(8);
    let step = Duration::from_millis(100);
    let started_at = SystemTime::now();

    while started_at.elapsed().unwrap_or_default() < timeout {
        if is_backend_ready(port) {
            log_desktop_event(app, &format!("backend port became ready: {port}"));
            return Ok(());
        }
        thread::sleep(step);
    }

    log_desktop_event(app, &format!("backend did not become ready before timeout: {port}"));
    Err(format!("CodeM 后端启动超时，端口 {port} 未就绪。"))
}

#[cfg(windows)]
fn start_backend_pty_process(
    app: &tauri::AppHandle,
    backend_processes: &BackendPtyProcesses,
    backend_port: u16,
    command: CommandBuilder,
    label: &str,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(pty_size(120, 32))
        .map_err(|error| format!("创建后台终端失败: {error}"))?;
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("启动 {label} 失败: {error}"))?;
    let pid = child.process_id();
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("创建后台日志读取器失败: {error}"))?;
    let log_path = backend_log_path(app)?;

    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    let data = String::from_utf8_lossy(&buffer[..read]).to_string();
                    append_log_chunk(&log_path, &data);
                }
                Err(error) => {
                    append_log_line(&log_path, &format!("后台 PTY 读取失败: {error}"));
                    break;
                }
            }
        }
    });

    let mut process_slot = backend_processes
        .process
        .lock()
        .map_err(|error| error.to_string())?;
    if let Some(existing) = process_slot.as_mut() {
        let _ = existing.child.kill();
        let _ = existing.child.wait();
    }
    *process_slot = Some(BackendPtyProcess {
        _master: pair.master,
        child,
    });

    if let Some(pid) = pid {
        log_desktop_event(app, &format!("{label} spawned via pty: pid={pid}, port={backend_port}"));
    } else {
        log_desktop_event(app, &format!("{label} spawned via pty: port={backend_port}"));
    }
    wait_for_backend_ready(app, backend_port)
}

fn current_timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[cfg(windows)]
#[cfg(not(windows))]
fn development_backend_command() -> Command {
    let mut command = Command::new("cmd.exe");
    command.args(["/D", "/S", "/C", "npm run dev:server"]);
    command
}

#[cfg(test)]
mod tests {
    use super::{
        clamp_window_state_to_area, has_minimum_window_size, normalize_window_state,
        prepare_window_state_for_save, resolve_backend_port_from_value, MonitorWorkArea, WindowState,
    };

    #[test]
    fn resolve_backend_port_from_value_accepts_valid_port() {
        assert_eq!(resolve_backend_port_from_value(Some("3162")), Some(3162));
    }

    #[test]
    fn resolve_backend_port_from_value_rejects_empty_or_invalid_values() {
        assert_eq!(resolve_backend_port_from_value(None), None);
        assert_eq!(resolve_backend_port_from_value(Some("")), None);
        assert_eq!(resolve_backend_port_from_value(Some("0")), None);
        assert_eq!(resolve_backend_port_from_value(Some("not-a-port")), None);
    }

    #[test]
    fn normalize_window_state_clamps_oversized_window_to_monitor_bounds() {
        let state = WindowState {
            x: -1497,
            y: 666,
            width: 4692,
            height: 2814,
        };
        let work_areas = [MonitorWorkArea {
            x: -1536,
            y: 0,
            width: 1536,
            height: 864,
        }];

        let normalized = normalize_window_state(state, &work_areas);

        assert_eq!(
            normalized,
            Some(WindowState {
                x: -1536,
                y: 0,
                width: 1536,
                height: 864,
            })
        );
    }

    #[test]
    fn normalize_window_state_rejects_window_outside_all_monitors() {
        let state = WindowState {
            x: 5000,
            y: 4000,
            width: 1400,
            height: 900,
        };
        let work_areas = [MonitorWorkArea {
            x: 0,
            y: 0,
            width: 2560,
            height: 1440,
        }];

        assert_eq!(normalize_window_state(state, &work_areas), None);
    }

    #[test]
    fn clamp_window_state_to_area_keeps_valid_window_unchanged() {
        let state = WindowState {
            x: 120,
            y: 80,
            width: 1440,
            height: 900,
        };
        let area = MonitorWorkArea {
            x: 0,
            y: 0,
            width: 2560,
            height: 1440,
        };

        assert_eq!(clamp_window_state_to_area(state, area), state);
    }

    #[test]
    fn prepare_window_state_for_save_keeps_valid_state_unchanged() {
        let state = WindowState {
            x: 2498,
            y: 242,
            width: 2617,
            height: 2518,
        };

        assert_eq!(prepare_window_state_for_save(state), Some(state));
    }

    #[test]
    fn has_minimum_window_size_rejects_small_window() {
        let state = WindowState {
            x: 0,
            y: 0,
            width: 640,
            height: 480,
        };

        assert!(!has_minimum_window_size(state));
    }
}

#[cfg(not(windows))]
fn development_backend_command() -> Command {
    let mut command = Command::new("npm");
    command.args(["run", "dev:server"]);
    command
}

fn material_info(id: i32) -> WindowMaterial {
    let name = match id {
        1 => "None",
        2 => "Mica",
        3 => "Acrylic",
        4 => "Mica Alt",
        _ => "Auto",
    };

    WindowMaterial { id, name }
}

#[cfg(windows)]
mod platform {
    use super::{material_info, WindowMaterial};
    use std::{ffi::c_void, mem::size_of};
    use tauri::Manager;
    use windows::Win32::{
        Foundation::HWND,
        Graphics::Dwm::{DwmGetWindowAttribute, DwmSetWindowAttribute, DWMWA_SYSTEMBACKDROP_TYPE},
        UI::WindowsAndMessaging::GetParent,
    };

    pub fn supported_window_materials() -> Vec<WindowMaterial> {
        let mut materials = vec![material_info(0), material_info(1)];
        let build = windows_version::OsVersion::current().build;

        if build >= 22523 {
            materials.push(material_info(2));
            materials.push(material_info(3));
            materials.push(material_info(4));
        }

        materials
    }

    pub fn current_window_material(app: &tauri::AppHandle) -> Result<WindowMaterial, String> {
        let hwnd = main_hwnd(app)?;
        let mut material = 0i32;

        unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_SYSTEMBACKDROP_TYPE,
                (&mut material as *mut i32).cast::<c_void>(),
                size_of::<i32>() as u32,
            )
            .map_err(|error| format!("读取窗口材质失败: {error}"))?;
        }

        Ok(material_info(material))
    }

    pub fn set_window_material(
        app: &tauri::AppHandle,
        material: i32,
    ) -> Result<WindowMaterial, String> {
        let hwnd = main_hwnd(app)?;
        let material = normalize_material(material)?;

        unsafe {
            DwmSetWindowAttribute(
                hwnd,
                DWMWA_SYSTEMBACKDROP_TYPE,
                (&material as *const i32).cast::<c_void>(),
                size_of::<i32>() as u32,
            )
            .map_err(|error| format!("切换窗口材质失败: {error}"))?;
        }

        Ok(material_info(material))
    }

    fn main_hwnd(app: &tauri::AppHandle) -> Result<HWND, String> {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "未找到主窗口".to_string())?;
        let mut hwnd = window
            .hwnd()
            .map_err(|error| format!("获取窗口句柄失败: {error}"))?;

        unsafe {
            while let Ok(parent) = GetParent(hwnd) {
                if parent.is_invalid() {
                    break;
                }
                hwnd = parent;
            }
        }

        Ok(hwnd)
    }

    fn normalize_material(material: i32) -> Result<i32, String> {
        match material {
            0..=4 => Ok(material),
            _ => Err(format!("不支持的窗口材质: {material}")),
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::{material_info, WindowMaterial};
    use std::process::Command;

    pub fn prepare_hidden_background_command(_command: &mut Command) {}

    pub fn supported_window_materials() -> Vec<WindowMaterial> {
        vec![material_info(0)]
    }

    pub fn current_window_material(_app: &tauri::AppHandle) -> Result<WindowMaterial, String> {
        Ok(material_info(0))
    }

    pub fn set_window_material(
        _app: &tauri::AppHandle,
        material: i32,
    ) -> Result<WindowMaterial, String> {
        if material == 0 {
            return Ok(material_info(0));
        }

        Err("当前平台不支持窗口材质切换".to_string())
    }
}
