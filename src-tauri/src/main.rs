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
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, Url, WindowEvent};

const WINDOW_STATE_FILE_NAME: &str = "window-state.json";
const DESKTOP_LOG_FILE_NAME: &str = "desktop.log";
const BACKEND_APP_DATA_DIR_ENV: &str = "CODEM_APP_DATA_DIR";
const BACKEND_DATA_DIR_NAME: &str = "data";
#[cfg(target_os = "windows")]
const WINDOWS_BACKEND_DATA_DIR_NAME: &str = "CodeM";
const BACKEND_IDENTITY_PATH: &str = "/api/runtime/identity";
const MIN_WINDOW_WIDTH: u32 = 960;
const MIN_WINDOW_HEIGHT: u32 = 640;
#[cfg(target_os = "windows")]
const POWERSHELL_7_PATH: &str = r"C:\Program Files\PowerShell\7\pwsh.exe";

#[cfg(target_os = "windows")]
fn updater_builder() -> tauri_plugin_updater::Builder {
    let builder = tauri_plugin_updater::Builder::new();
    let Ok(exe) = std::env::current_exe() else {
        return builder;
    };
    let Some(dir) = exe.parent() else {
        return builder;
    };
    builder.installer_arg(format!("/D={}", dir.display()))
}

#[cfg(not(target_os = "windows"))]
fn updater_builder() -> tauri_plugin_updater::Builder {
    tauri_plugin_updater::Builder::new()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowMaterial {
    id: i32,
    name: &'static str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThreadNotificationRequest {
    title: String,
    body: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppRuntimeInfo {
    version: String,
    repository_url: &'static str,
    distribution_mode: &'static str,
    runtime_flavor: &'static str,
    is_tauri: bool,
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

#[derive(Default)]
#[allow(dead_code)]
struct WindowMaterialState {
    current: Mutex<Option<i32>>,
}

fn should_apply_window_material(current: Option<i32>, requested: i32) -> bool {
    current != Some(requested)
}

fn clear_vibrancy_layers<E>(mut clear: impl FnMut() -> Result<bool, E>) -> Result<usize, E> {
    let mut cleared = 0;
    while clear()? {
        cleared += 1;
    }
    Ok(cleared)
}

#[derive(Clone, Copy)]
struct BackendStartupTarget {
    port: u16,
    reuse_existing: bool,
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
fn open_external_url(url: String) -> Result<(), String> {
    let parsed = Url::parse(url.trim()).map_err(|error| format!("外部链接地址无效: {error}"))?;
    let url = match parsed.scheme() {
        "http" | "https" => parsed,
        scheme => return Err(format!("不支持的外部链接协议: {scheme}")),
    };

    platform::open_external_url(url.as_str())
}

fn parse_browser_webview_url(value: &str) -> Result<Url, String> {
    let parsed = Url::parse(value.trim()).map_err(|error| format!("浏览器地址无效: {error}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("内置浏览器仅支持 HTTP 和 HTTPS 地址".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("请勿在网址中直接包含账号或密码".to_string());
    }
    Ok(parsed)
}

fn validate_browser_webview_label(label: &str) -> Result<(), String> {
    if label.starts_with("codem-browser-")
        && label.len() <= 96
        && label
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        Ok(())
    } else {
        Err("浏览器视图标识无效".to_string())
    }
}

fn browser_webview(app: &AppHandle, label: &str) -> Result<tauri::Webview<tauri::Wry>, String> {
    validate_browser_webview_label(label)?;
    app.webviews()
        .get(label)
        .cloned()
        .ok_or_else(|| "浏览器视图不存在".to_string())
}

#[tauri::command]
fn browser_webview_navigate(app: AppHandle, label: String, url: String) -> Result<(), String> {
    let url = parse_browser_webview_url(&url)?;
    browser_webview(&app, &label)?
        .navigate(url)
        .map_err(|error| format!("打开网页失败: {error}"))
}

#[tauri::command]
fn browser_webview_control(app: AppHandle, label: String, action: String) -> Result<(), String> {
    let webview = browser_webview(&app, &label)?;
    match action.as_str() {
        "back" => webview
            .eval("history.back()")
            .map_err(|error| format!("浏览器后退失败: {error}")),
        "forward" => webview
            .eval("history.forward()")
            .map_err(|error| format!("浏览器前进失败: {error}")),
        "reload" => webview
            .reload()
            .map_err(|error| format!("刷新网页失败: {error}")),
        _ => Err("不支持的浏览器操作".to_string()),
    }
}

#[tauri::command]
fn browser_webview_url(app: AppHandle, label: String) -> Result<String, String> {
    browser_webview(&app, &label)?
        .url()
        .map(|url| url.to_string())
        .map_err(|error| format!("读取浏览器地址失败: {error}"))
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
fn pick_files(initial_path: Option<String>) -> Result<Vec<String>, String> {
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
        .pick_files()
        .map(|paths| {
            paths
                .into_iter()
                .map(|path| path.display().to_string())
                .collect()
        })
        .unwrap_or_default())
}

#[tauri::command]
fn get_backend_base_url(state: State<'_, BackendPortState>) -> Result<String, String> {
    let port = *state.port.lock().map_err(|error| error.to_string())?;
    Ok(format!("http://127.0.0.1:{port}"))
}

#[tauri::command]
fn show_thread_notification(
    app: AppHandle,
    request: ThreadNotificationRequest,
) -> Result<(), String> {
    platform::show_thread_notification(&app, request)
}

#[tauri::command]
fn get_app_runtime_info(app: AppHandle) -> Result<AppRuntimeInfo, String> {
    let package_info = app.package_info();
    Ok(AppRuntimeInfo {
        version: package_info.version.to_string(),
        repository_url: "https://github.com/syscryer/codem",
        distribution_mode: detect_distribution_mode(&app),
        runtime_flavor: detect_runtime_flavor(&app),
        is_tauri: true,
    })
}

fn main() {
    #[cfg(windows)]
    platform::declare_process_app_user_model_id();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(updater_builder().build())
        .manage(PtySessions::default())
        .manage(BackendPortState {
            port: Mutex::new(3001),
        })
        .manage(WindowMaterialState::default());

    builder
        .setup(|app| {
            let app_handle = app.handle().clone();
            restore_main_window_state(&app_handle);
            focus_main_window(&app_handle);
            if let Err(error) =
                platform::set_window_material(&app_handle, platform::default_window_material_id())
            {
                log_desktop_event(
                    &app_handle,
                    &format!("default window material failed: {error}"),
                );
            }
            match resolve_backend_startup_target(&app_handle) {
                Ok(target) => start_backend_startup_check(app_handle, target),
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
            pick_files,
            get_backend_base_url,
            open_external_url,
            browser_webview_navigate,
            browser_webview_control,
            browser_webview_url,
            show_thread_notification,
            get_app_runtime_info
        ])
        .build(tauri::generate_context!())
        .expect("failed to build CodeM desktop shell")
        .run(|_app_handle, _event| {});
}

fn start_backend_startup_check(app: tauri::AppHandle, target: BackendStartupTarget) {
    if target.reuse_existing {
        log_desktop_event(&app, "backend start check completed");
        return;
    }

    log_desktop_event(
        &app,
        &format!("backend start check scheduled: {}", target.port),
    );
    thread::spawn(move || {
        let startup_result = ensure_backend_started_impl(&app, target.port);

        match startup_result {
            Ok(()) => log_desktop_event(&app, "backend start check completed"),
            Err(error) => log_desktop_event(&app, &format!("backend start failed: {error}")),
        }
    });
}

fn detect_distribution_mode(app: &tauri::AppHandle) -> &'static str {
    let Ok(executable_dir) = app.path().executable_dir() else {
        return "desktop-nsis";
    };
    detect_distribution_mode_from_dir(&executable_dir)
}

fn detect_distribution_mode_from_dir(executable_dir: &Path) -> &'static str {
    if executable_dir.join("portable.marker").exists() {
        return "desktop-portable";
    }

    "desktop-nsis"
}

fn detect_runtime_flavor(app: &tauri::AppHandle) -> &'static str {
    let _ = app;
    "rust"
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
    let _ = window.set_position(PhysicalPosition::new(
        normalized_state.x,
        normalized_state.y,
    ));
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

fn normalize_window_state(
    state: WindowState,
    work_areas: &[MonitorWorkArea],
) -> Option<WindowState> {
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
    let max_x = area
        .x
        .saturating_add(area.width.saturating_sub(width as i32));
    let max_y = area
        .y
        .saturating_add(area.height.saturating_sub(height as i32));
    let x = state.x.clamp(area.x, max_x);
    let y = state.y.clamp(area.y, max_y);

    WindowState {
        x,
        y,
        width,
        height,
    }
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

fn ensure_backend_started_impl(app: &tauri::AppHandle, backend_port: u16) -> Result<(), String> {
    start_rust_backend_thread(app, backend_port)
}

fn start_rust_backend_thread(app: &tauri::AppHandle, backend_port: u16) -> Result<(), String> {
    let app_data_dir =
        backend_app_data_dir(app).ok_or_else(|| "无法定位 CodeM 后端数据目录".to_string())?;
    log_desktop_event(
        app,
        &format!(
            "start rust backend: port={}, data={}",
            backend_port,
            app_data_dir.display()
        ),
    );

    let app_for_thread = app.clone();
    thread::spawn(move || {
        if let Err(error) = codem::backend::run_blocking_with_config(backend_port, app_data_dir) {
            log_desktop_event(&app_for_thread, &format!("rust backend exited: {error}"));
        }
    });

    wait_for_backend_ready(app, backend_port)
}

fn is_backend_ready(port: u16) -> bool {
    probe_backend_identity(port).is_ok_and(|response| {
        has_success_status(&response)
            && response.contains("\"app\":\"codem\"")
            && response.contains("\"backend\":\"rust\"")
    })
}

fn is_tcp_port_open(port: u16) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&address, Duration::from_millis(240)).is_ok()
}

fn probe_backend_identity(port: u16) -> Result<String, String> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(240))
        .map_err(|error| error.to_string())?;
    let timeout = Some(Duration::from_millis(600));
    stream
        .set_read_timeout(timeout)
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(timeout)
        .map_err(|error| error.to_string())?;
    write!(
        stream,
        "GET {BACKEND_IDENTITY_PATH} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    )
    .map_err(|error| error.to_string())?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| error.to_string())?;
    Ok(response)
}

fn has_success_status(response: &str) -> bool {
    response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200")
}

fn resolve_backend_startup_target(app: &tauri::AppHandle) -> Result<BackendStartupTarget, String> {
    if let Some(port) = configured_backend_port() {
        if is_backend_ready(port) {
            set_backend_port(app, port)?;
            log_desktop_event(app, &format!("reusing existing backend port: {port}"));
            return Ok(BackendStartupTarget {
                port,
                reuse_existing: true,
            });
        }
        if is_tcp_port_open(port) {
            let fallback_port = allocate_backend_port()?;
            set_backend_port(app, fallback_port)?;
            log_desktop_event(
                app,
                &format!(
                    "configured backend port {port} is occupied by a non-CodeM backend, starting backend on {fallback_port}"
                ),
            );
            return Ok(BackendStartupTarget {
                port: fallback_port,
                reuse_existing: false,
            });
        }

        set_backend_port(app, port)?;
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

fn backend_app_data_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Some(value) = std::env::var_os(BACKEND_APP_DATA_DIR_ENV) {
        if !value.to_string_lossy().trim().is_empty() {
            return Some(PathBuf::from(value));
        }
    }

    if let Some(directory) = default_backend_app_data_dir() {
        return Some(directory);
    }

    app.path()
        .app_config_dir()
        .ok()
        .map(|directory| directory.join(BACKEND_DATA_DIR_NAME))
}

#[cfg(target_os = "windows")]
fn default_backend_app_data_dir() -> Option<PathBuf> {
    env_path("LOCALAPPDATA")
        .or_else(|| env_path("APPDATA"))
        .or_else(|| env_path("USERPROFILE").map(|home| home.join("AppData").join("Local")))
        .or_else(|| env_path("HOME").map(|home| home.join("AppData").join("Local")))
        .map(|directory| directory.join(WINDOWS_BACKEND_DATA_DIR_NAME))
}

#[cfg(not(target_os = "windows"))]
fn default_backend_app_data_dir() -> Option<PathBuf> {
    None
}

#[cfg(target_os = "windows")]
fn env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .filter(|value| !value.to_string_lossy().trim().is_empty())
        .map(PathBuf::from)
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

fn log_desktop_event(app: &tauri::AppHandle, message: &str) {
    if let Ok(path) = desktop_log_path(app) {
        append_log_line(&path, message);
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

    log_desktop_event(
        app,
        &format!("backend did not become ready before timeout: {port}"),
    );
    Err(format!("CodeM 后端启动超时，端口 {port} 未就绪。"))
}

fn current_timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::{
        clamp_window_state_to_area, clear_vibrancy_layers, detect_distribution_mode_from_dir,
        has_minimum_window_size, has_success_status, normalize_window_state,
        parse_browser_webview_url, prepare_window_state_for_save, resolve_backend_port_from_value,
        should_apply_window_material, validate_browser_webview_label, MonitorWorkArea, WindowState,
    };
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
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
    fn has_success_status_accepts_http_200_status_line() {
        assert!(has_success_status("HTTP/1.1 200 OK\r\n\r\n{}"));
        assert!(has_success_status("HTTP/1.0 200 OK\r\n\r\n{}"));
        assert!(!has_success_status("HTTP/1.1 404 Not Found\r\n\r\n{}"));
    }

    #[test]
    fn browser_webview_url_only_accepts_http_without_embedded_credentials() {
        assert!(parse_browser_webview_url("https://example.com/docs").is_ok());
        assert!(parse_browser_webview_url("http://127.0.0.1:5173").is_ok());
        assert!(parse_browser_webview_url("file:///C:/secret.txt").is_err());
        assert!(parse_browser_webview_url("javascript:alert(1)").is_err());
        assert!(parse_browser_webview_url("https://user:pass@example.com").is_err());
    }

    #[test]
    fn browser_webview_label_cannot_target_the_main_app_webview() {
        assert!(validate_browser_webview_label("codem-browser-tab-12345678").is_ok());
        assert!(validate_browser_webview_label("main").is_err());
        assert!(validate_browser_webview_label("codem-browser-../main").is_err());
    }

    #[test]
    fn window_material_state_requires_initial_and_changed_applications() {
        assert!(should_apply_window_material(None, 0));
        assert!(!should_apply_window_material(Some(0), 0));
        assert!(should_apply_window_material(Some(1), 0));
    }

    #[test]
    fn clear_vibrancy_layers_removes_every_layer_and_stops() {
        let mut remaining_layers = 3;
        let mut calls = 0;

        let cleared = clear_vibrancy_layers(|| {
            calls += 1;
            if remaining_layers == 0 {
                Ok::<bool, ()>(false)
            } else {
                remaining_layers -= 1;
                Ok(true)
            }
        })
        .expect("clear simulated vibrancy layers");

        assert_eq!(cleared, 3);
        assert_eq!(remaining_layers, 0);
        assert_eq!(calls, 4);
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

    #[test]
    fn detect_distribution_mode_from_dir_returns_portable_when_marker_exists() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let temp_dir = std::env::temp_dir().join(format!("codem-portable-marker-{unique}"));
        fs::create_dir_all(&temp_dir).expect("create temp dir");
        fs::write(temp_dir.join("portable.marker"), b"").expect("create marker file");

        let mode = detect_distribution_mode_from_dir(&temp_dir);

        fs::remove_dir_all(&temp_dir).expect("remove temp dir");
        assert_eq!(mode, "desktop-portable");
    }
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
    use super::{material_info, ThreadNotificationRequest, WindowMaterial};
    use std::{ffi::c_void, mem::size_of};
    use tauri::Manager;
    use tauri_winrt_notification::{Duration, Toast};
    use windows::{
        core::{w, HSTRING, PCWSTR},
        Win32::{
            Foundation::HWND,
            Graphics::Dwm::{
                DwmGetWindowAttribute, DwmSetWindowAttribute, DWMWA_SYSTEMBACKDROP_TYPE,
            },
            UI::{
                Shell::{SetCurrentProcessExplicitAppUserModelID, ShellExecuteW},
                WindowsAndMessaging::{GetParent, SW_SHOWNORMAL},
            },
        },
    };

    const CODEM_APP_USER_MODEL_ID: &str = "com.mnl.codem";

    pub fn declare_process_app_user_model_id() {
        unsafe {
            let _ = SetCurrentProcessExplicitAppUserModelID(w!("com.mnl.codem"));
        }
    }

    pub fn default_window_material_id() -> i32 {
        2
    }

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

    pub fn open_external_url(url: &str) -> Result<(), String> {
        let target = HSTRING::from(url);
        let result = unsafe {
            ShellExecuteW(
                None,
                w!("open"),
                &target,
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            )
        };
        let code = result.0 as isize;

        if code <= 32 {
            return Err(format!("打开外部链接失败: {code}"));
        }

        Ok(())
    }

    pub fn show_thread_notification(
        _app: &tauri::AppHandle,
        request: ThreadNotificationRequest,
    ) -> Result<(), String> {
        Toast::new(CODEM_APP_USER_MODEL_ID)
            .title(&request.title)
            .text1(&request.body)
            .duration(Duration::Short)
            .show()
            .map_err(|error| format!("发送系统通知失败: {error}"))
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

#[cfg(target_os = "macos")]
mod platform {
    use super::{
        clear_vibrancy_layers, material_info, should_apply_window_material,
        ThreadNotificationRequest, WindowMaterial, WindowMaterialState,
    };
    use std::process::Command;
    use tauri::Manager;
    use window_vibrancy::{
        apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial, NSVisualEffectState,
    };

    pub fn default_window_material_id() -> i32 {
        0
    }

    pub fn prepare_hidden_background_command(_command: &mut Command) {}

    pub fn supported_window_materials() -> Vec<WindowMaterial> {
        vec![material_info(0), material_info(1)]
    }

    pub fn current_window_material(app: &tauri::AppHandle) -> Result<WindowMaterial, String> {
        let state = app.state::<WindowMaterialState>();
        let material = state
            .current
            .lock()
            .map_err(|error| error.to_string())?
            .unwrap_or(default_window_material_id());
        Ok(material_info(material))
    }

    pub fn set_window_material(
        app: &tauri::AppHandle,
        material: i32,
    ) -> Result<WindowMaterial, String> {
        if !matches!(material, 0 | 1) {
            return Err("当前平台仅支持自动和无两种窗口材质".to_string());
        }

        let state = app.state::<WindowMaterialState>();
        let mut current = state.current.lock().map_err(|error| error.to_string())?;
        if !should_apply_window_material(*current, material) {
            return Ok(material_info(material));
        }

        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "未找到主窗口".to_string())?;

        match material {
            0 => {
                clear_vibrancy_layers(|| clear_vibrancy(&window))
                    .map_err(|error| format!("清理 macOS 玻璃效果失败: {error}"))?;
                apply_vibrancy(
                    &window,
                    NSVisualEffectMaterial::Sidebar,
                    Some(NSVisualEffectState::FollowsWindowActiveState),
                    None,
                )
                .map_err(|error| format!("应用 macOS 玻璃效果失败: {error}"))?;
            }
            1 => {
                clear_vibrancy_layers(|| clear_vibrancy(&window))
                    .map_err(|error| format!("关闭 macOS 玻璃效果失败: {error}"))?;
            }
            _ => unreachable!(),
        }

        *current = Some(material);

        Ok(material_info(material))
    }

    pub fn open_external_url(url: &str) -> Result<(), String> {
        let status = Command::new("open")
            .arg(url)
            .status()
            .map_err(|error| format!("打开外部链接失败: {error}"))?;

        if status.success() {
            Ok(())
        } else {
            Err(format!("打开外部链接失败: {status}"))
        }
    }

    pub fn show_thread_notification(
        app: &tauri::AppHandle,
        request: ThreadNotificationRequest,
    ) -> Result<(), String> {
        use tauri_plugin_notification::NotificationExt;

        app.notification()
            .builder()
            .title(request.title)
            .body(request.body)
            .show()
            .map_err(|error| format!("发送系统通知失败: {error}"))
    }
}

#[cfg(all(not(windows), not(target_os = "macos")))]
mod platform {
    use super::{material_info, ThreadNotificationRequest, WindowMaterial};
    use std::process::Command;

    pub fn default_window_material_id() -> i32 {
        0
    }

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

    pub fn open_external_url(url: &str) -> Result<(), String> {
        let status = Command::new("xdg-open")
            .arg(url)
            .status()
            .map_err(|error| format!("打开外部链接失败: {error}"))?;

        if status.success() {
            Ok(())
        } else {
            Err(format!("打开外部链接失败: {status}"))
        }
    }

    pub fn show_thread_notification(
        app: &tauri::AppHandle,
        request: ThreadNotificationRequest,
    ) -> Result<(), String> {
        use tauri_plugin_notification::NotificationExt;

        app.notification()
            .builder()
            .title(request.title)
            .body(request.body)
            .show()
            .map_err(|error| format!("发送系统通知失败: {error}"))
    }
}
