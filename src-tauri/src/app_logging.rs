//! CodeM 后端结构化文件日志与日志查看/诊断 API。
//!
//! - 按天滚动写入 `{app_data_dir}/logs/backend.log.YYYY-MM-DD`，保留约 7 天
//! - 行格式固定为 `[YYYY-MM-DD HH:MM:SS.mmm] [LEVEL] [target] message fields`
//! - 日志内容不包含 API Key、Token 或消息正文；`redact_secrets` 作为兜底脱敏工具

use std::fmt;
use std::fs;
use std::io::{Read as _, Write as _};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use axum::extract::{Query, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::fmt::format::{FormatEvent, Writer};
use tracing_subscriber::fmt::{FmtContext, FormatFields};

pub const LOG_FILE_PREFIX: &str = "backend.log";
const RETENTION_DAYS: i64 = 7;
const RETENTION_FILE_COUNT: usize = 10;
const MAX_TAIL_BYTES: u64 = 8 * 1024 * 1024;

static LOG_GUARD: OnceLock<WorkerGuard> = OnceLock::new();

struct CodeMLogFormat;

impl<S, N> FormatEvent<S, N> for CodeMLogFormat
where
    S: tracing::Subscriber + for<'a> tracing_subscriber::registry::LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
{
    fn format_event(
        &self,
        ctx: &FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &tracing::Event<'_>,
    ) -> fmt::Result {
        let metadata = event.metadata();
        write!(
            writer,
            "[{}] [{}] [{}] ",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
            metadata.level(),
            metadata.target()
        )?;
        ctx.field_format().format_fields(writer.by_ref(), event)?;
        writeln!(writer)
    }
}

/// 初始化全局文件日志；重复调用是安全的（仅第一次生效）。
pub fn init(app_data_dir: &Path) {
    if LOG_GUARD.get().is_some() {
        return;
    }
    let directory = logs_dir(app_data_dir);
    if let Err(error) = fs::create_dir_all(&directory) {
        eprintln!("初始化日志目录失败: {} {error}", directory.display());
        return;
    }
    cleanup_expired_logs(&directory);

    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    let appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix(LOG_FILE_PREFIX)
        .max_log_files(RETENTION_FILE_COUNT)
        .build(&directory);
    let appender = match appender {
        Ok(appender) => appender,
        Err(error) => {
            eprintln!("创建日志滚动写入器失败: {} {error}", directory.display());
            return;
        }
    };
    let (non_blocking, guard) = tracing_appender::non_blocking(appender);
    let result = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_ansi(false)
        .with_writer(non_blocking)
        .event_format(CodeMLogFormat)
        .try_init();
    if result.is_ok() {
        let _ = LOG_GUARD.set(guard);
        tracing::info!(
            target: "codem::logging",
            "文件日志已启用: dir={} pid={}",
            directory.display(),
            std::process::id()
        );
    }
}

pub fn logs_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("logs")
}

fn cleanup_expired_logs(directory: &Path) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let cutoff = chrono::Local::now()
        - chrono::TimeDelta::try_days(RETENTION_DAYS).unwrap_or_else(|| chrono::TimeDelta::zero());
    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let name = entry.file_name();
        if !metadata.is_file() || !name.to_string_lossy().starts_with(LOG_FILE_PREFIX) {
            continue;
        }
        let expired = metadata
            .modified()
            .ok()
            .map(|modified| chrono::DateTime::<chrono::Local>::from(modified) < cutoff)
            .unwrap_or(false);
        if expired {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// 兜底脱敏：遮蔽 Bearer Token、sk- 密钥、key/token 查询参数与超长随机串。
pub fn redact_secrets(text: &str) -> String {
    text.split_whitespace()
        .map(|word| match redact_word(word) {
            Some(redacted) => redacted,
            None => word,
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn redact_word(word: &str) -> Option<&'static str> {
    let lower = word.to_ascii_lowercase();
    if lower.starts_with("bearer:") || lower.starts_with("bearer=") || lower == "bearer" {
        return Some("***");
    }
    if lower.starts_with("sk-") && word.len() > 12 {
        return Some("***");
    }
    if (lower.starts_with("key=")
        || lower.starts_with("token=")
        || lower.starts_with("api_key=")
        || lower.starts_with("apikey=")
        || lower.starts_with("password="))
        && word.len() > 8
    {
        return Some("***");
    }
    if word.len() >= 40
        && word
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Some("***");
    }
    None
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFileMeta {
    pub name: String,
    pub size_bytes: u64,
    pub modified_at: String,
}

pub fn is_safe_log_file_name(name: &str) -> bool {
    let basic = !name.is_empty()
        && name.len() <= 128
        && !name.starts_with('.')
        && !name.contains(['/', '\\'])
        && !name.contains("..")
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if !basic {
        return false;
    }
    if name.ends_with(".log") {
        return true;
    }
    name.strip_prefix(&format!("{LOG_FILE_PREFIX}."))
        .is_some_and(|suffix| {
            suffix.len() == 10 && suffix.chars().all(|c| c.is_ascii_digit() || c == '-')
        })
}

/// 解析 `[ts] [LEVEL] [target] ...` 行的日志级别（扫描各 `[]` 段）。
pub fn parse_log_level(line: &str) -> Option<&'static str> {
    let mut search_from = 0;
    while let Some(open) = line[search_from..].find('[') {
        let open = search_from + open;
        let Some(close) = line[open + 1..].find(']') else {
            break;
        };
        let close = open + 1 + close;
        match &line[open + 1..close] {
            "TRACE" => return Some("trace"),
            "DEBUG" => return Some("debug"),
            "INFO" => return Some("info"),
            "WARN" => return Some("warn"),
            "ERROR" => return Some("error"),
            _ => {}
        }
        search_from = close + 1;
    }
    None
}

fn level_rank(level: &str) -> u8 {
    match level {
        "error" => 4,
        "warn" => 3,
        "info" => 2,
        "debug" => 1,
        "trace" => 0,
        _ => 2,
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogTailResult {
    pub lines: Vec<String>,
    pub matched_lines: usize,
    pub scanned_lines: usize,
    pub truncated_by_bytes: bool,
}

pub fn read_log_tail(
    directory: &Path,
    name: &str,
    max_lines: usize,
    level: Option<&str>,
    search: Option<&str>,
) -> Result<LogTailResult, String> {
    if !is_safe_log_file_name(name) {
        return Err("非法日志文件名".to_string());
    }
    let mut file = fs::File::open(directory.join(name))
        .map_err(|error| format!("打开日志文件失败: {error}"))?;
    let size = file
        .metadata()
        .map_err(|error| format!("读取日志文件信息失败: {error}"))?
        .len();
    let read_from = size.saturating_sub(MAX_TAIL_BYTES);
    if read_from > 0 {
        std::io::Seek::seek(&mut file, std::io::SeekFrom::Start(read_from))
            .map_err(|error| format!("定位日志文件失败: {error}"))?;
    }
    let mut raw = Vec::new();
    file.read_to_end(&mut raw)
        .map_err(|error| format!("读取日志文件失败: {error}"))?;
    let truncated_by_bytes = read_from > 0;
    let text = String::from_utf8_lossy(&raw);
    let mut lines: Vec<String> = text.lines().map(str::to_string).collect();
    if truncated_by_bytes && !lines.is_empty() {
        lines.remove(0);
    }
    let scanned_lines = lines.len();
    let min_rank = level
        .filter(|value| !value.is_empty() && *value != "all")
        .map(level_rank);
    let keyword = search
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_lowercase);
    let mut matched = Vec::<String>::new();
    for line in lines {
        let level_ok = min_rank
            .map(|min| parse_log_level(&line).map(level_rank).unwrap_or(0) >= min)
            .unwrap_or(true);
        if !level_ok {
            continue;
        }
        if let Some(keyword) = keyword.as_deref() {
            if !line.to_ascii_lowercase().contains(keyword) {
                continue;
            }
        }
        matched.push(line);
        if matched.len() >= max_lines {
            break;
        }
    }
    Ok(LogTailResult {
        matched_lines: matched.len(),
        scanned_lines,
        lines: matched,
        truncated_by_bytes,
    })
}

pub fn list_log_files(directory: &Path) -> Vec<LogFileMeta> {
    let Ok(entries) = fs::read_dir(directory) else {
        return Vec::new();
    };
    let mut files = entries
        .flatten()
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if !is_safe_log_file_name(&name) {
                return None;
            }
            let modified_at = metadata
                .modified()
                .ok()
                .map(|time| {
                    chrono::DateTime::<chrono::Local>::from(time)
                        .format("%Y-%m-%d %H:%M:%S")
                        .to_string()
                })
                .unwrap_or_default();
            Some(LogFileMeta {
                name,
                size_bytes: metadata.len(),
                modified_at,
            })
        })
        .collect::<Vec<_>>();
    files.sort_by(|a, b| b.name.cmp(&a.name));
    files
}

#[derive(Clone)]
pub struct LogService {
    logs_directory: PathBuf,
}

impl LogService {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            logs_directory: logs_dir(&app_data_dir),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LogTailQuery {
    file: Option<String>,
    #[serde(default = "default_tail_lines")]
    lines: usize,
    level: Option<String>,
    search: Option<String>,
}

fn default_tail_lines() -> usize {
    500
}

async fn list_files(State(service): State<LogService>) -> Json<Value> {
    let files = list_log_files(&service.logs_directory);
    Json(json!({
        "files": files,
        "directory": service.logs_directory.to_string_lossy(),
    }))
}

async fn tail_files(
    State(service): State<LogService>,
    Query(query): Query<LogTailQuery>,
) -> Json<Value> {
    let Some(file) = query.file.as_deref() else {
        return Json(json!({ "error": "缺少 file 参数" }));
    };
    let max_lines = query.lines.clamp(1, 5000);
    match read_log_tail(
        &service.logs_directory,
        file,
        max_lines,
        query.level.as_deref(),
        query.search.as_deref(),
    ) {
        Ok(result) => Json(json!({
            "file": file,
            "lines": result.lines,
            "matchedLines": result.matched_lines,
            "scannedLines": result.scanned_lines,
            "truncatedByBytes": result.truncated_by_bytes,
        })),
        Err(error) => Json(json!({ "error": redact_secrets(&error) })),
    }
}

async fn export_bundle(State(service): State<LogService>) -> Json<Value> {
    match build_diagnostic_bundle(&service.logs_directory) {
        Ok(path) => {
            let opened = reveal_in_file_manager(&path);
            tracing::info!(
                target: "codem::logging",
                "诊断包已导出: file={} opened={opened}",
                path.display()
            );
            Json(json!({
                "path": path.to_string_lossy(),
                "opened": opened,
            }))
        }
        Err(error) => Json(json!({ "error": redact_secrets(&error) })),
    }
}

pub fn build_diagnostic_bundle(logs_directory: &Path) -> Result<PathBuf, String> {
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let export_dir = logs_directory.join("exports");
    fs::create_dir_all(&export_dir).map_err(|error| format!("创建导出目录失败: {error}"))?;
    let zip_path = export_dir.join(format!("codem-diagnostics-{stamp}.zip"));
    let file = fs::File::create(&zip_path).map_err(|error| format!("创建诊断包失败: {error}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let info = json!({
        "app": "codem",
        "version": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "pid": std::process::id(),
        "generatedAt": chrono::Local::now().to_rfc3339(),
    });
    zip.start_file("info.json", options)
        .map_err(|error| format!("写入诊断信息失败: {error}"))?;
    zip.write_all(
        serde_json::to_vec_pretty(&info)
            .unwrap_or_else(|_| b"{}".to_vec())
            .as_slice(),
    )
    .map_err(|error| format!("写入诊断信息失败: {error}"))?;

    for meta in list_log_files(logs_directory) {
        let Ok(content) = fs::read(logs_directory.join(&meta.name)) else {
            continue;
        };
        zip.start_file(meta.name.clone(), options)
            .map_err(|error| format!("写入日志失败: {error}"))?;
        zip.write_all(&content)
            .map_err(|error| format!("写入日志失败: {error}"))?;
    }
    zip.finish()
        .map_err(|error| format!("完成诊断包失败: {error}"))?;
    Ok(zip_path)
}

fn reveal_in_file_manager(path: &Path) -> bool {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .spawn()
            .is_ok()
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .is_ok()
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        path.parent()
            .map(|parent| {
                std::process::Command::new("xdg-open")
                    .arg(parent)
                    .spawn()
                    .is_ok()
            })
            .unwrap_or(false)
    }
}

pub fn router(service: LogService) -> Router {
    Router::new()
        .route("/api/logs/files", get(list_files))
        .route("/api/logs/tail", get(tail_files))
        .route("/api/logs/export", post(export_bundle))
        .with_state(service)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("codem-log-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn safe_log_file_name_rejects_traversal() {
        assert!(is_safe_log_file_name("backend.log"));
        assert!(is_safe_log_file_name("backend.log.2026-08-19"));
        assert!(!is_safe_log_file_name("../desktop.log"));
        assert!(!is_safe_log_file_name("a/b.log"));
        assert!(!is_safe_log_file_name("a\\b.log"));
        assert!(!is_safe_log_file_name(".hidden.log"));
        assert!(!is_safe_log_file_name("notes.txt"));
        assert!(!is_safe_log_file_name("backend.log.2026/08/19"));
    }

    #[test]
    fn parse_level_reads_bracket_level() {
        assert_eq!(
            parse_log_level("[2026-08-19 10:25:00.123] [WARN] [codem::backend] boom"),
            Some("warn")
        );
        assert_eq!(parse_log_level("plain line"), None);
    }

    #[test]
    fn redact_masks_common_secrets() {
        let text = "key=sk-abc123def456ghi789xyz token=averylongsecretvalue1234567890 keepme";
        let redacted = redact_secrets(text);
        assert!(!redacted.contains("sk-abc123"));
        assert!(!redacted.contains("averylongsecret"));
        assert!(redacted.contains("keepme"));
    }

    #[test]
    fn tail_filters_level_and_search() {
        let dir = temp_dir();
        fs::write(
            dir.join("backend.log"),
            "[2026-08-19 10:00:00.000] [INFO] [t] started\n\
             [2026-08-19 10:00:01.000] [WARN] [t] opencode missing\n\
             [2026-08-19 10:00:02.000] [ERROR] [t] crash",
        )
        .unwrap();
        let warn = read_log_tail(&dir, "backend.log", 100, Some("warn"), None).unwrap();
        assert_eq!(warn.lines.len(), 2);
        let search = read_log_tail(&dir, "backend.log", 100, None, Some("opencode")).unwrap();
        assert_eq!(search.lines.len(), 1);
        assert!(search.lines[0].contains("opencode"));
        let error = read_log_tail(&dir, "backend.log", 100, Some("error"), None).unwrap();
        assert_eq!(error.lines.len(), 1);
        assert!(error.lines[0].contains("crash"));
        let limited = read_log_tail(&dir, "backend.log", 1, Some("warn"), None).unwrap();
        assert_eq!(limited.lines.len(), 1);
        assert!(read_log_tail(&dir, "../x.log", 10, None, None).is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn diagnostic_bundle_contains_logs_and_info() {
        let dir = temp_dir();
        fs::write(dir.join("backend.log"), "[x] [INFO] [t] hello").unwrap();
        let zip_path = build_diagnostic_bundle(&dir).unwrap();
        let file = fs::File::open(&zip_path).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let names: Vec<String> = (0..archive.len())
            .map(|index| archive.by_index(index).unwrap().name().to_string())
            .collect();
        assert!(names.contains(&"info.json".to_string()));
        assert!(names.contains(&"backend.log".to_string()));
        let _ = fs::remove_dir_all(dir);
    }
}
