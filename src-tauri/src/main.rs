#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{
    fs,
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};
use tauri::{Manager, PhysicalPosition, PhysicalSize, WindowEvent};

const DEFAULT_WINDOW_MATERIAL_ID: i32 = 2;
const WINDOW_STATE_FILE_NAME: &str = "window-state.json";
const MIN_WINDOW_WIDTH: u32 = 720;
const MIN_WINDOW_HEIGHT: u32 = 480;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowMaterial {
    id: i32,
    name: &'static str,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowState {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
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

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle().clone();
            restore_main_window_state(&app_handle);
            let _ = platform::set_window_material(&app_handle, DEFAULT_WINDOW_MATERIAL_ID);
            let _ = ensure_backend_started(&app_handle);
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
            set_window_material
        ])
        .run(tauri::generate_context!())
        .expect("failed to run CodeM desktop shell");
}

fn restore_main_window_state(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let Some(state) = load_window_state(app) else {
        return;
    };

    if !is_valid_window_state(&window, state) {
        return;
    }

    let _ = window.set_size(PhysicalSize::new(state.width, state.height));
    let _ = window.set_position(PhysicalPosition::new(state.x, state.y));
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
        .outer_size()
        .map_err(|error| format!("读取窗口尺寸失败: {error}"))?;

    let state = WindowState {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };

    if state.width < MIN_WINDOW_WIDTH || state.height < MIN_WINDOW_HEIGHT {
        return Ok(());
    }

    let path = window_state_path(window.app_handle())?;
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

fn is_valid_window_state(window: &tauri::WebviewWindow, state: WindowState) -> bool {
    if state.width < MIN_WINDOW_WIDTH || state.height < MIN_WINDOW_HEIGHT {
        return false;
    }

    let Ok(monitors) = window.available_monitors() else {
        return true;
    };

    monitors.iter().any(|monitor| {
        let area = monitor.work_area();
        rects_intersect(
            state.x,
            state.y,
            state.width as i32,
            state.height as i32,
            area.position.x,
            area.position.y,
            area.size.width as i32,
            area.size.height as i32,
        )
    })
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

fn ensure_backend_started(app: &tauri::AppHandle) -> Result<(), String> {
    if is_backend_ready() {
        return Ok(());
    }

    if let Some(server_entry) = find_packaged_backend_entry(app) {
        return start_node_backend_process(&server_entry);
    }

    if let Some(server_entry) = find_development_backend_entry() {
        return start_node_backend_process(&server_entry);
    }

    let project_root = find_project_root().ok_or_else(|| "未找到 CodeM 项目目录".to_string())?;
    start_development_backend_process(&project_root)
}

fn is_backend_ready() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], 3001));
    TcpStream::connect_timeout(&address, Duration::from_millis(240)).is_ok()
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
    app.path()
        .resource_dir()
        .ok()
        .map(|directory| directory.join("dist-server").join("index.mjs"))
        .filter(|entry| fs::metadata(entry).is_ok())
}

fn find_development_backend_entry() -> Option<PathBuf> {
    find_project_root()
        .map(|root| root.join("dist-server").join("index.mjs"))
        .filter(|entry| fs::metadata(entry).is_ok())
}

fn start_node_backend_process(server_entry: &Path) -> Result<(), String> {
    let cwd = server_entry
        .parent()
        .and_then(Path::parent)
        .unwrap_or_else(|| Path::new("."));
    let mut command = node_backend_command(server_entry);
    command
        .current_dir(cwd)
        .env("NODE_ENV", "production")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    platform::prepare_hidden_background_command(&mut command);

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("启动 CodeM 后端失败: {error}"))
}

fn start_development_backend_process(project_root: &Path) -> Result<(), String> {
    let mut command = development_backend_command();
    command
        .current_dir(project_root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    platform::prepare_hidden_background_command(&mut command);

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("启动 CodeM 后端失败: {error}"))
}

fn node_backend_command(server_entry: &Path) -> Command {
    let mut command = Command::new("node");
    command.arg("--experimental-sqlite").arg(server_entry);
    command
}

#[cfg(windows)]
fn development_backend_command() -> Command {
    let mut command = Command::new("cmd.exe");
    command.args(["/D", "/S", "/C", "npm run dev:server"]);
    command
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
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    use std::{ffi::c_void, mem::size_of};
    use tauri::Manager;
    use windows::Win32::{
        Foundation::HWND,
        Graphics::Dwm::{DwmGetWindowAttribute, DwmSetWindowAttribute, DWMWA_SYSTEMBACKDROP_TYPE},
        UI::WindowsAndMessaging::GetParent,
    };

    const CREATE_NO_WINDOW: u32 = 0x08000000;

    pub fn prepare_hidden_background_command(command: &mut Command) {
        command.creation_flags(CREATE_NO_WINDOW);
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
