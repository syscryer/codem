use axum::{
    extract::{Path as AxumPath, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, patch, post, put},
    Json, Router,
};
use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};

const MAX_NAME_CHARS: usize = 120;
const MAX_PROMPT_CHARS: usize = 200_000;
const MAX_SCHEDULE_BYTES: usize = 16 * 1024;
const STALE_RUN_AFTER_MS: i64 = 12 * 60 * 60 * 1000;
const RECENT_RUN_LIMIT: i64 = 240;

#[derive(Clone)]
pub(crate) struct AutomationService {
    app_data_dir: Arc<PathBuf>,
    write_lock: Arc<Mutex<()>>,
}

#[derive(Debug)]
struct AutomationApiError {
    status: StatusCode,
    message: String,
}

impl AutomationApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.into(),
        }
    }

    fn conflict(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
        }
    }
}

impl IntoResponse for AutomationApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}

type AutomationResult<T> = Result<T, AutomationApiError>;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveAutomationRequest {
    name: String,
    prompt: String,
    project_id: String,
    provider_id: String,
    #[serde(default)]
    channel_id: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    reasoning_effort: Option<String>,
    permission_mode: String,
    schedule: Value,
    #[serde(default)]
    next_run_at_ms: Option<i64>,
    enabled: bool,
    #[serde(default = "default_execution_environment")]
    execution_environment: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaimAutomationRequest {
    now_ms: i64,
    next_run_at_ms: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManualRunRequest {
    now_ms: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAutomationRunRequest {
    status: String,
    #[serde(default)]
    thread_id: Option<String>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    now_ms: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AutomationDefinition {
    id: String,
    name: String,
    prompt: String,
    project_id: String,
    provider_id: String,
    channel_id: Option<String>,
    model: Option<String>,
    reasoning_effort: Option<String>,
    permission_mode: String,
    schedule: Value,
    next_run_at_ms: Option<i64>,
    enabled: bool,
    execution_environment: String,
    created_at: String,
    updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AutomationRun {
    id: String,
    automation_id: String,
    thread_id: Option<String>,
    status: String,
    trigger: String,
    scheduled_for_ms: i64,
    started_at_ms: Option<i64>,
    finished_at_ms: Option<i64>,
    error: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AutomationBootstrap {
    automations: Vec<AutomationDefinition>,
    runs: Vec<AutomationRun>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaimedAutomationRun {
    automation: AutomationDefinition,
    run: AutomationRun,
}

impl AutomationService {
    pub(crate) fn new(app_data_dir: PathBuf) -> Self {
        Self {
            app_data_dir: Arc::new(app_data_dir),
            write_lock: Arc::new(Mutex::new(())),
        }
    }

    fn open_database(&self) -> AutomationResult<Connection> {
        fs::create_dir_all(self.app_data_dir.as_ref()).map_err(|error| {
            AutomationApiError::internal(format!("创建自动化数据目录失败: {error}"))
        })?;
        let connection =
            Connection::open(self.app_data_dir.join("codem.sqlite")).map_err(|error| {
                AutomationApiError::internal(format!("打开自动化数据库失败: {error}"))
            })?;
        initialize_database(&connection)?;
        Ok(connection)
    }

    fn bootstrap(&self) -> AutomationResult<AutomationBootstrap> {
        let connection = self.open_database()?;
        Ok(AutomationBootstrap {
            automations: list_automations(&connection)?,
            runs: list_recent_runs(&connection)?,
        })
    }

    fn create(&self, request: SaveAutomationRequest) -> AutomationResult<AutomationDefinition> {
        let normalized = normalize_save_request(request)?;
        let _guard = self
            .write_lock
            .lock()
            .map_err(|error| AutomationApiError::internal(format!("自动化写入锁异常: {error}")))?;
        let connection = self.open_database()?;
        ensure_project_exists(&connection, &normalized.project_id)?;
        let now = current_timestamp();
        let id = uuid::Uuid::new_v4().to_string();
        connection
            .execute(
                r#"
                INSERT INTO automations (
                  id, name, prompt, project_id, provider_id, channel_id, model,
                  reasoning_effort, permission_mode, schedule_json, next_run_at_ms,
                  enabled, execution_environment, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                "#,
                params![
                    id,
                    normalized.name,
                    normalized.prompt,
                    normalized.project_id,
                    normalized.provider_id,
                    normalized.channel_id,
                    normalized.model,
                    normalized.reasoning_effort,
                    normalized.permission_mode,
                    serde_json::to_string(&normalized.schedule)
                        .unwrap_or_else(|_| "{}".to_string()),
                    normalized.next_run_at_ms,
                    bool_to_i64(normalized.enabled),
                    normalized.execution_environment,
                    now,
                    now,
                ],
            )
            .map_err(|error| AutomationApiError::internal(format!("创建自动化失败: {error}")))?;
        read_automation(&connection, &id)
    }

    fn update(
        &self,
        automation_id: &str,
        request: SaveAutomationRequest,
    ) -> AutomationResult<AutomationDefinition> {
        let normalized = normalize_save_request(request)?;
        let _guard = self
            .write_lock
            .lock()
            .map_err(|error| AutomationApiError::internal(format!("自动化写入锁异常: {error}")))?;
        let connection = self.open_database()?;
        ensure_project_exists(&connection, &normalized.project_id)?;
        let changed = connection
            .execute(
                r#"
                UPDATE automations SET
                  name = ?, prompt = ?, project_id = ?, provider_id = ?, channel_id = ?,
                  model = ?, reasoning_effort = ?, permission_mode = ?, schedule_json = ?,
                  next_run_at_ms = ?, enabled = ?, execution_environment = ?, updated_at = ?
                WHERE id = ?
                "#,
                params![
                    normalized.name,
                    normalized.prompt,
                    normalized.project_id,
                    normalized.provider_id,
                    normalized.channel_id,
                    normalized.model,
                    normalized.reasoning_effort,
                    normalized.permission_mode,
                    serde_json::to_string(&normalized.schedule)
                        .unwrap_or_else(|_| "{}".to_string()),
                    normalized.next_run_at_ms,
                    bool_to_i64(normalized.enabled),
                    normalized.execution_environment,
                    current_timestamp(),
                    automation_id,
                ],
            )
            .map_err(|error| AutomationApiError::internal(format!("更新自动化失败: {error}")))?;
        if changed == 0 {
            return Err(AutomationApiError::not_found("自动化不存在"));
        }
        read_automation(&connection, automation_id)
    }

    fn delete(&self, automation_id: &str) -> AutomationResult<()> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|error| AutomationApiError::internal(format!("自动化写入锁异常: {error}")))?;
        let connection = self.open_database()?;
        let active = count_active_runs(&connection, automation_id, i64::MAX)?;
        if active > 0 {
            return Err(AutomationApiError::conflict("自动化正在运行，完成后再删除"));
        }
        let changed = connection
            .execute(
                "DELETE FROM automations WHERE id = ?",
                params![automation_id],
            )
            .map_err(|error| AutomationApiError::internal(format!("删除自动化失败: {error}")))?;
        if changed == 0 {
            return Err(AutomationApiError::not_found("自动化不存在"));
        }
        Ok(())
    }

    fn claim_scheduled(
        &self,
        automation_id: &str,
        request: ClaimAutomationRequest,
    ) -> AutomationResult<ClaimedAutomationRun> {
        if request.now_ms <= 0 || request.next_run_at_ms <= request.now_ms {
            return Err(AutomationApiError::bad_request(
                "下次运行时间必须晚于当前时间",
            ));
        }
        self.create_run(
            automation_id,
            "scheduled",
            request.now_ms,
            Some(request.next_run_at_ms),
        )
    }

    fn create_manual_run(
        &self,
        automation_id: &str,
        request: ManualRunRequest,
    ) -> AutomationResult<ClaimedAutomationRun> {
        if request.now_ms <= 0 {
            return Err(AutomationApiError::bad_request("运行时间无效"));
        }
        self.create_run(automation_id, "manual", request.now_ms, None)
    }

    fn create_run(
        &self,
        automation_id: &str,
        trigger: &str,
        now_ms: i64,
        next_run_at_ms: Option<i64>,
    ) -> AutomationResult<ClaimedAutomationRun> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|error| AutomationApiError::internal(format!("自动化写入锁异常: {error}")))?;
        let mut connection = self.open_database()?;
        let transaction = connection.transaction().map_err(|error| {
            AutomationApiError::internal(format!("启动自动化事务失败: {error}"))
        })?;
        settle_stale_runs(&transaction, automation_id, now_ms)?;
        let automation = read_automation_from(&transaction, automation_id)?;
        if trigger == "scheduled" {
            if !automation.enabled {
                return Err(AutomationApiError::conflict("自动化已停用"));
            }
            if automation
                .next_run_at_ms
                .is_none_or(|scheduled| scheduled > now_ms)
            {
                return Err(AutomationApiError::conflict("自动化尚未到运行时间"));
            }
        }
        if count_active_runs_from(&transaction, automation_id, now_ms - STALE_RUN_AFTER_MS)? > 0 {
            return Err(AutomationApiError::conflict("自动化已有运行中的任务"));
        }
        if let Some(next_run_at_ms) = next_run_at_ms {
            let changed = transaction
                .execute(
                    "UPDATE automations SET next_run_at_ms = ?, updated_at = ? WHERE id = ? AND enabled = 1 AND next_run_at_ms <= ?",
                    params![next_run_at_ms, current_timestamp(), automation_id, now_ms],
                )
                .map_err(|error| AutomationApiError::internal(format!("领取自动化失败: {error}")))?;
            if changed == 0 {
                return Err(AutomationApiError::conflict("自动化已被其他窗口领取"));
            }
        }
        let run_id = uuid::Uuid::new_v4().to_string();
        let now = current_timestamp();
        transaction
            .execute(
                r#"
                INSERT INTO automation_runs (
                  id, automation_id, thread_id, status, trigger, scheduled_for_ms,
                  started_at_ms, finished_at_ms, error, created_at, updated_at
                ) VALUES (?, ?, NULL, 'claimed', ?, ?, NULL, NULL, NULL, ?, ?)
                "#,
                params![run_id, automation_id, trigger, now_ms, now, now],
            )
            .map_err(|error| {
                AutomationApiError::internal(format!("记录自动化运行失败: {error}"))
            })?;
        transaction.commit().map_err(|error| {
            AutomationApiError::internal(format!("提交自动化领取失败: {error}"))
        })?;
        let connection = self.open_database()?;
        Ok(ClaimedAutomationRun {
            automation: read_automation(&connection, automation_id)?,
            run: read_run(&connection, &run_id)?,
        })
    }

    fn update_run(
        &self,
        run_id: &str,
        request: UpdateAutomationRunRequest,
    ) -> AutomationResult<AutomationRun> {
        let status = normalize_run_status(&request.status)?;
        let thread_id = normalize_optional_text(request.thread_id, 512, "threadId")?;
        let error = normalize_optional_text(request.error, 4096, "error")?;
        let now_ms = request
            .now_ms
            .unwrap_or_else(|| Utc::now().timestamp_millis());
        let started_at_ms = matches!(status, "running" | "waiting").then_some(now_ms);
        let finished_at_ms = is_terminal_status(status).then_some(now_ms);
        let _guard = self.write_lock.lock().map_err(|lock_error| {
            AutomationApiError::internal(format!("自动化写入锁异常: {lock_error}"))
        })?;
        let connection = self.open_database()?;
        let changed = connection
            .execute(
                r#"
                UPDATE automation_runs SET
                  status = ?,
                  thread_id = COALESCE(?, thread_id),
                  started_at_ms = COALESCE(started_at_ms, ?),
                  finished_at_ms = ?,
                  error = ?,
                  updated_at = ?
                WHERE id = ?
                "#,
                params![
                    status,
                    thread_id,
                    started_at_ms,
                    finished_at_ms,
                    error,
                    current_timestamp(),
                    run_id,
                ],
            )
            .map_err(|db_error| {
                AutomationApiError::internal(format!("更新自动化运行失败: {db_error}"))
            })?;
        if changed == 0 {
            return Err(AutomationApiError::not_found("自动化运行不存在"));
        }
        read_run(&connection, run_id)
    }
}

pub(crate) fn router(service: AutomationService) -> Router {
    Router::new()
        .route("/api/automations/bootstrap", get(automation_bootstrap))
        .route("/api/automations", post(create_automation))
        .route(
            "/api/automations/{automation_id}",
            put(update_automation).delete(delete_automation),
        )
        .route(
            "/api/automations/{automation_id}/claim",
            post(claim_scheduled_automation),
        )
        .route(
            "/api/automations/{automation_id}/runs",
            post(create_manual_automation_run),
        )
        .route(
            "/api/automation-runs/{run_id}",
            patch(update_automation_run),
        )
        .with_state(service)
}

async fn automation_bootstrap(
    State(service): State<AutomationService>,
) -> AutomationResult<Json<AutomationBootstrap>> {
    Ok(Json(service.bootstrap()?))
}

async fn create_automation(
    State(service): State<AutomationService>,
    Json(request): Json<SaveAutomationRequest>,
) -> AutomationResult<(StatusCode, Json<AutomationDefinition>)> {
    Ok((StatusCode::CREATED, Json(service.create(request)?)))
}

async fn update_automation(
    State(service): State<AutomationService>,
    AxumPath(automation_id): AxumPath<String>,
    Json(request): Json<SaveAutomationRequest>,
) -> AutomationResult<Json<AutomationDefinition>> {
    Ok(Json(service.update(&automation_id, request)?))
}

async fn delete_automation(
    State(service): State<AutomationService>,
    AxumPath(automation_id): AxumPath<String>,
) -> AutomationResult<StatusCode> {
    service.delete(&automation_id)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn claim_scheduled_automation(
    State(service): State<AutomationService>,
    AxumPath(automation_id): AxumPath<String>,
    Json(request): Json<ClaimAutomationRequest>,
) -> AutomationResult<Json<ClaimedAutomationRun>> {
    Ok(Json(service.claim_scheduled(&automation_id, request)?))
}

async fn create_manual_automation_run(
    State(service): State<AutomationService>,
    AxumPath(automation_id): AxumPath<String>,
    Json(request): Json<ManualRunRequest>,
) -> AutomationResult<(StatusCode, Json<ClaimedAutomationRun>)> {
    Ok((
        StatusCode::CREATED,
        Json(service.create_manual_run(&automation_id, request)?),
    ))
}

async fn update_automation_run(
    State(service): State<AutomationService>,
    AxumPath(run_id): AxumPath<String>,
    Json(request): Json<UpdateAutomationRunRequest>,
) -> AutomationResult<Json<AutomationRun>> {
    Ok(Json(service.update_run(&run_id, request)?))
}

fn initialize_database(connection: &Connection) -> AutomationResult<()> {
    connection
        .execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS automations (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              prompt TEXT NOT NULL,
              project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              provider_id TEXT NOT NULL,
              channel_id TEXT,
              model TEXT,
              reasoning_effort TEXT,
              permission_mode TEXT NOT NULL,
              schedule_json TEXT NOT NULL,
              next_run_at_ms INTEGER,
              enabled INTEGER NOT NULL DEFAULT 1,
              execution_environment TEXT NOT NULL DEFAULT 'local',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS automation_runs (
              id TEXT PRIMARY KEY,
              automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
              thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
              status TEXT NOT NULL,
              trigger TEXT NOT NULL,
              scheduled_for_ms INTEGER NOT NULL,
              started_at_ms INTEGER,
              finished_at_ms INTEGER,
              error TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_automations_next_run
            ON automations (enabled, next_run_at_ms);
            CREATE INDEX IF NOT EXISTS idx_automation_runs_automation
            ON automation_runs (automation_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_automation_runs_status
            ON automation_runs (automation_id, status, started_at_ms);
            "#,
        )
        .map_err(|error| AutomationApiError::internal(format!("初始化自动化数据库失败: {error}")))
}

fn list_automations(connection: &Connection) -> AutomationResult<Vec<AutomationDefinition>> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT id, name, prompt, project_id, provider_id, channel_id, model,
                   reasoning_effort, permission_mode, schedule_json, next_run_at_ms,
                   enabled, execution_environment, created_at, updated_at
            FROM automations
            ORDER BY enabled DESC, updated_at DESC
            "#,
        )
        .map_err(|error| AutomationApiError::internal(format!("读取自动化失败: {error}")))?;
    let rows = statement
        .query_map([], automation_from_row)
        .map_err(|error| AutomationApiError::internal(format!("读取自动化失败: {error}")))?;
    collect_rows(rows, "读取自动化失败")
}

fn read_automation(
    connection: &Connection,
    automation_id: &str,
) -> AutomationResult<AutomationDefinition> {
    read_automation_from(connection, automation_id)
}

fn read_automation_from(
    connection: &Connection,
    automation_id: &str,
) -> AutomationResult<AutomationDefinition> {
    connection
        .query_row(
            r#"
            SELECT id, name, prompt, project_id, provider_id, channel_id, model,
                   reasoning_effort, permission_mode, schedule_json, next_run_at_ms,
                   enabled, execution_environment, created_at, updated_at
            FROM automations WHERE id = ?
            "#,
            params![automation_id],
            automation_from_row,
        )
        .optional()
        .map_err(|error| AutomationApiError::internal(format!("读取自动化失败: {error}")))?
        .ok_or_else(|| AutomationApiError::not_found("自动化不存在"))
}

fn automation_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AutomationDefinition> {
    let schedule_json: String = row.get(9)?;
    Ok(AutomationDefinition {
        id: row.get(0)?,
        name: row.get(1)?,
        prompt: row.get(2)?,
        project_id: row.get(3)?,
        provider_id: row.get(4)?,
        channel_id: row.get(5)?,
        model: row.get(6)?,
        reasoning_effort: row.get(7)?,
        permission_mode: row.get(8)?,
        schedule: serde_json::from_str(&schedule_json).unwrap_or_else(|_| json!({})),
        next_run_at_ms: row.get(10)?,
        enabled: row.get::<_, i64>(11)? != 0,
        execution_environment: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

fn list_recent_runs(connection: &Connection) -> AutomationResult<Vec<AutomationRun>> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT id, automation_id, thread_id, status, trigger, scheduled_for_ms,
                   started_at_ms, finished_at_ms, error, created_at, updated_at
            FROM automation_runs
            ORDER BY created_at DESC
            LIMIT ?
            "#,
        )
        .map_err(|error| AutomationApiError::internal(format!("读取自动化运行失败: {error}")))?;
    let rows = statement
        .query_map(params![RECENT_RUN_LIMIT], run_from_row)
        .map_err(|error| AutomationApiError::internal(format!("读取自动化运行失败: {error}")))?;
    collect_rows(rows, "读取自动化运行失败")
}

fn read_run(connection: &Connection, run_id: &str) -> AutomationResult<AutomationRun> {
    connection
        .query_row(
            r#"
            SELECT id, automation_id, thread_id, status, trigger, scheduled_for_ms,
                   started_at_ms, finished_at_ms, error, created_at, updated_at
            FROM automation_runs WHERE id = ?
            "#,
            params![run_id],
            run_from_row,
        )
        .optional()
        .map_err(|error| AutomationApiError::internal(format!("读取自动化运行失败: {error}")))?
        .ok_or_else(|| AutomationApiError::not_found("自动化运行不存在"))
}

fn run_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AutomationRun> {
    Ok(AutomationRun {
        id: row.get(0)?,
        automation_id: row.get(1)?,
        thread_id: row.get(2)?,
        status: row.get(3)?,
        trigger: row.get(4)?,
        scheduled_for_ms: row.get(5)?,
        started_at_ms: row.get(6)?,
        finished_at_ms: row.get(7)?,
        error: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn normalize_save_request(
    request: SaveAutomationRequest,
) -> AutomationResult<SaveAutomationRequest> {
    let name = normalize_required_text(request.name, MAX_NAME_CHARS, "名称")?;
    let prompt = normalize_required_text(request.prompt, MAX_PROMPT_CHARS, "提示词")?;
    let project_id = normalize_required_text(request.project_id, 512, "项目")?;
    let provider_id = normalize_required_text(request.provider_id, 64, "Agent")?;
    if !matches!(
        provider_id.as_str(),
        "claude-code" | "grok-build" | "openai-codex" | "opencode"
    ) {
        return Err(AutomationApiError::bad_request("不支持的 Agent"));
    }
    let permission_mode = normalize_required_text(request.permission_mode, 64, "权限")?;
    if !matches!(
        permission_mode.as_str(),
        "default" | "auto" | "bypassPermissions"
    ) {
        return Err(AutomationApiError::bad_request(
            "自动化权限仅支持 default、auto 或 bypassPermissions",
        ));
    }
    if request.schedule.to_string().len() > MAX_SCHEDULE_BYTES || !request.schedule.is_object() {
        return Err(AutomationApiError::bad_request("执行计划格式无效"));
    }
    let next_run_at_ms = if request.enabled {
        request
            .next_run_at_ms
            .filter(|value| *value > 0)
            .ok_or_else(|| AutomationApiError::bad_request("启用自动化时必须提供下次运行时间"))?
            .into()
    } else {
        request.next_run_at_ms.filter(|value| *value > 0)
    };
    let execution_environment =
        normalize_required_text(request.execution_environment, 32, "执行环境")?;
    if execution_environment != "local" {
        return Err(AutomationApiError::bad_request(
            "首版仅支持项目当前目录执行",
        ));
    }
    Ok(SaveAutomationRequest {
        name,
        prompt,
        project_id,
        provider_id,
        channel_id: normalize_optional_text(request.channel_id, 512, "channelId")?,
        model: normalize_optional_text(request.model, 512, "model")?,
        reasoning_effort: normalize_optional_text(
            request.reasoning_effort,
            128,
            "reasoningEffort",
        )?,
        permission_mode,
        schedule: request.schedule,
        next_run_at_ms,
        enabled: request.enabled,
        execution_environment,
    })
}

fn normalize_required_text(
    value: String,
    max_chars: usize,
    label: &str,
) -> AutomationResult<String> {
    let value = value.trim().to_string();
    if value.is_empty() {
        return Err(AutomationApiError::bad_request(format!("{label}不能为空")));
    }
    if value.chars().count() > max_chars || value.chars().any(char::is_control) {
        return Err(AutomationApiError::bad_request(format!("{label}格式无效")));
    }
    Ok(value)
}

fn normalize_optional_text(
    value: Option<String>,
    max_chars: usize,
    label: &str,
) -> AutomationResult<Option<String>> {
    value
        .map(|value| normalize_required_text(value, max_chars, label))
        .transpose()
}

fn normalize_run_status(value: &str) -> AutomationResult<&'static str> {
    match value.trim() {
        "running" => Ok("running"),
        "waiting" => Ok("waiting"),
        "completed" => Ok("completed"),
        "failed" => Ok("failed"),
        "stopped" => Ok("stopped"),
        _ => Err(AutomationApiError::bad_request("自动化运行状态无效")),
    }
}

fn is_terminal_status(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "stopped")
}

fn ensure_project_exists(connection: &Connection, project_id: &str) -> AutomationResult<()> {
    let exists = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?)",
            params![project_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| AutomationApiError::internal(format!("读取自动化项目失败: {error}")))?
        != 0;
    if !exists {
        return Err(AutomationApiError::bad_request("项目不存在"));
    }
    Ok(())
}

fn settle_stale_runs(
    transaction: &Transaction<'_>,
    automation_id: &str,
    now_ms: i64,
) -> AutomationResult<()> {
    transaction
        .execute(
            r#"
            UPDATE automation_runs SET
              status = 'failed', finished_at_ms = ?, error = '应用中断，运行状态已过期', updated_at = ?
            WHERE automation_id = ?
              AND status IN ('claimed', 'running', 'waiting')
              AND COALESCE(started_at_ms, scheduled_for_ms) < ?
            "#,
            params![
                now_ms,
                current_timestamp(),
                automation_id,
                now_ms - STALE_RUN_AFTER_MS,
            ],
        )
        .map_err(|error| AutomationApiError::internal(format!("恢复自动化运行状态失败: {error}")))?;
    Ok(())
}

fn count_active_runs(
    connection: &Connection,
    automation_id: &str,
    active_after_ms: i64,
) -> AutomationResult<i64> {
    count_active_runs_from(connection, automation_id, active_after_ms)
}

fn count_active_runs_from(
    connection: &Connection,
    automation_id: &str,
    active_after_ms: i64,
) -> AutomationResult<i64> {
    connection
        .query_row(
            r#"
            SELECT COUNT(*) FROM automation_runs
            WHERE automation_id = ?
              AND status IN ('claimed', 'running', 'waiting')
              AND COALESCE(started_at_ms, scheduled_for_ms) >= ?
            "#,
            params![automation_id, active_after_ms],
            |row| row.get(0),
        )
        .map_err(|error| AutomationApiError::internal(format!("读取自动化运行状态失败: {error}")))
}

fn collect_rows<T>(
    rows: rusqlite::MappedRows<'_, impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>>,
    message: &str,
) -> AutomationResult<Vec<T>> {
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| AutomationApiError::internal(format!("{message}: {error}")))
}

fn current_timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn bool_to_i64(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn default_execution_environment() -> String {
    "local".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service_with_project() -> (AutomationService, PathBuf) {
        let root = std::env::temp_dir().join(format!("codem-automation-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let connection = Connection::open(root.join("codem.sqlite")).unwrap();
        connection
            .execute_batch(
                r#"
                PRAGMA foreign_keys = ON;
                CREATE TABLE projects (id TEXT PRIMARY KEY);
                CREATE TABLE threads (id TEXT PRIMARY KEY);
                INSERT INTO projects (id) VALUES ('project-a');
                "#,
            )
            .unwrap();
        (AutomationService::new(root.clone()), root)
    }

    fn request(next_run_at_ms: i64) -> SaveAutomationRequest {
        SaveAutomationRequest {
            name: "每日检查".to_string(),
            prompt: "检查项目状态并给出摘要".to_string(),
            project_id: "project-a".to_string(),
            provider_id: "openai-codex".to_string(),
            channel_id: None,
            model: None,
            reasoning_effort: Some("medium".to_string()),
            permission_mode: "auto".to_string(),
            schedule: json!({ "kind": "daily", "time": "09:00" }),
            next_run_at_ms: Some(next_run_at_ms),
            enabled: true,
            execution_environment: "local".to_string(),
        }
    }

    #[test]
    fn automation_crud_persists_configuration() {
        let (service, root) = service_with_project();
        let created = service.create(request(2_000)).unwrap();
        assert_eq!(created.provider_id, "openai-codex");
        assert_eq!(created.next_run_at_ms, Some(2_000));

        let mut update = request(3_000);
        update.enabled = false;
        let updated = service.update(&created.id, update).unwrap();
        assert!(!updated.enabled);
        assert_eq!(service.bootstrap().unwrap().automations.len(), 1);

        service.delete(&created.id).unwrap();
        assert!(service.bootstrap().unwrap().automations.is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn scheduled_claim_is_atomic_and_advances_next_run() {
        let (service, root) = service_with_project();
        let created = service.create(request(1_000)).unwrap();
        let claimed = service
            .claim_scheduled(
                &created.id,
                ClaimAutomationRequest {
                    now_ms: 1_500,
                    next_run_at_ms: 5_000,
                },
            )
            .unwrap();
        assert_eq!(claimed.run.status, "claimed");
        assert_eq!(claimed.automation.next_run_at_ms, Some(5_000));

        let duplicate = service.claim_scheduled(
            &created.id,
            ClaimAutomationRequest {
                now_ms: 1_500,
                next_run_at_ms: 5_000,
            },
        );
        assert!(duplicate.is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn manual_run_does_not_change_schedule() {
        let (service, root) = service_with_project();
        let created = service.create(request(8_000)).unwrap();
        let claimed = service
            .create_manual_run(&created.id, ManualRunRequest { now_ms: 2_000 })
            .unwrap();
        assert_eq!(claimed.run.trigger, "manual");
        assert_eq!(claimed.automation.next_run_at_ms, Some(8_000));
        let _ = fs::remove_dir_all(root);
    }
}
