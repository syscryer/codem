mod knowledge;
mod mcp;
pub(crate) mod provider;
mod runtime;
pub(crate) mod secrets;
mod skills;
mod storage;
pub(crate) mod types;

use axum::{
    extract::{DefaultBodyLimit, Path as AxumPath, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, patch, post},
    Json, Router,
};
use serde_json::{json, Value};
use std::{collections::HashSet, path::PathBuf, sync::Arc};

use self::{
    knowledge::{
        create_knowledge_base, delete_knowledge_base, delete_knowledge_source, get_knowledge_base,
        import_knowledge_sources, list_knowledge_bases, rebuild_knowledge_base, search_request,
        update_knowledge_base, CreateKnowledgeBaseRequest, ImportKnowledgeSourceRequest,
        SearchKnowledgeRequest, UpdateKnowledgeBaseRequest,
    },
    provider::{discover_models, test_provider, PROVIDER_TEMPLATES},
    secrets::SecretStore,
    storage::{
        clear_chat, create_chat, delete_chat, delete_chat_turn,
        delete_model as delete_model_storage, get_chat, get_stored_provider, insert_provider,
        list_chats, list_models, list_providers, open_initialized_database,
        repair_provider_defaults, set_chat_pinned, set_default_provider,
        update_chat as update_chat_storage, upsert_model, upsert_models, ModelWrite,
    },
    types::{
        BatchSaveModelsRequest, CreateChatRequest, ProviderProbeRequest, SaveModelRequest,
        SaveProviderRequest, StoredProvider, UpdateChatRequest, UpdateModelRequest,
        UpdateProviderRequest,
    },
};

#[derive(Clone)]
pub(crate) struct OrdinaryChatService {
    state: OrdinaryChatState,
    runs: runtime::AiRunService,
}

#[derive(Clone)]
struct OrdinaryChatState {
    database_path: Arc<PathBuf>,
    secrets: SecretStore,
}

#[derive(Debug)]
struct AiApiError {
    status: StatusCode,
    message: String,
}

type AiApiResult<T> = Result<T, AiApiError>;

impl OrdinaryChatService {
    pub(crate) fn new(app_data_dir: PathBuf) -> Self {
        Self::with_secrets(app_data_dir.clone(), SecretStore::new(app_data_dir))
    }

    pub(crate) fn with_secrets(app_data_dir: PathBuf, secrets: SecretStore) -> Self {
        Self {
            state: OrdinaryChatState {
                database_path: Arc::new(app_data_dir.join("codem.sqlite")),
                secrets: secrets.clone(),
            },
            runs: runtime::AiRunService::new(app_data_dir.join("codem.sqlite"), secrets),
        }
    }
}

pub(crate) fn router(service: OrdinaryChatService) -> Router {
    let run_router = runtime::router(service.runs);
    Router::new()
        .route("/api/ai/bootstrap", get(ai_bootstrap))
        .route("/api/ai/chats", post(create_ai_chat))
        .route(
            "/api/ai/chats/{chat_id}",
            get(get_ai_chat)
                .patch(update_ai_chat)
                .delete(delete_ai_chat),
        )
        .route("/api/ai/chats/{chat_id}/pin", post(pin_ai_chat))
        .route("/api/ai/chats/{chat_id}/clear", post(clear_ai_chat))
        .route(
            "/api/ai/chats/{chat_id}/turns/{turn_id}",
            axum::routing::delete(delete_ai_chat_turn),
        )
        .route("/api/ai/providers/templates", get(provider_templates))
        .route("/api/ai/providers/probe", post(probe_provider_config))
        .route(
            "/api/ai/providers/models/discover",
            post(discover_draft_provider_models),
        )
        .route("/api/ai/providers", post(create_provider))
        .route(
            "/api/ai/providers/{provider_id}",
            patch(update_provider).delete(delete_provider),
        )
        .route(
            "/api/ai/providers/{provider_id}/test",
            post(test_provider_config),
        )
        .route(
            "/api/ai/providers/{provider_id}/api-key",
            get(get_provider_api_key),
        )
        .route(
            "/api/ai/providers/{provider_id}/models/refresh",
            post(refresh_provider_models),
        )
        .route(
            "/api/ai/providers/{provider_id}/models/discover",
            post(discover_saved_provider_models),
        )
        .route(
            "/api/ai/providers/{provider_id}/models/batch",
            post(create_models_batch),
        )
        .route("/api/ai/providers/{provider_id}/models", post(create_model))
        .route(
            "/api/ai/models/{model_id}",
            patch(update_model).delete(delete_model),
        )
        .route(
            "/api/ai/knowledge-bases",
            get(list_ai_knowledge_bases).post(create_ai_knowledge_base),
        )
        .route(
            "/api/ai/knowledge-bases/{knowledge_base_id}",
            get(get_ai_knowledge_base)
                .patch(update_ai_knowledge_base)
                .delete(delete_ai_knowledge_base),
        )
        .route(
            "/api/ai/knowledge-bases/{knowledge_base_id}/sources/import",
            post(import_ai_knowledge_sources),
        )
        .route(
            "/api/ai/knowledge-bases/{knowledge_base_id}/sources/{source_id}",
            axum::routing::delete(delete_ai_knowledge_source),
        )
        .route(
            "/api/ai/knowledge-bases/{knowledge_base_id}/rebuild",
            post(rebuild_ai_knowledge_base),
        )
        .route("/api/ai/knowledge/search", post(search_ai_knowledge))
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
        .with_state(service.state)
        .merge(run_router)
}

impl AiApiError {
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

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
        }
    }
}

impl IntoResponse for AiApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}

async fn ai_bootstrap(State(state): State<OrdinaryChatState>) -> AiApiResult<Json<Value>> {
    let connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    let providers = list_providers(&connection, |slot| state.secrets.has(slot))
        .map_err(AiApiError::internal)?;
    let chats = list_chats(&connection).map_err(AiApiError::internal)?;
    let knowledge_bases = list_knowledge_bases(&connection).map_err(AiApiError::internal)?;
    let mcp = crate::backend::list_mcp_servers_value(None);
    let skills = crate::backend::list_codex_skills_value(None);
    Ok(Json(json!({
        "providers": providers,
        "chats": chats,
        "knowledgeBases": knowledge_bases,
        "mcpServers": mcp.get("servers").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
        "skills": skills.get("skills").cloned().unwrap_or_else(|| Value::Array(Vec::new()))
    })))
}

async fn list_ai_knowledge_bases(
    State(state): State<OrdinaryChatState>,
) -> AiApiResult<Json<Value>> {
    let connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    let knowledge_bases = list_knowledge_bases(&connection).map_err(AiApiError::internal)?;
    Ok(Json(json!({ "knowledgeBases": knowledge_bases })))
}

async fn create_ai_knowledge_base(
    State(state): State<OrdinaryChatState>,
    Json(payload): Json<CreateKnowledgeBaseRequest>,
) -> AiApiResult<Json<Value>> {
    let connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    let knowledge_base =
        create_knowledge_base(&connection, payload).map_err(AiApiError::bad_request)?;
    Ok(Json(json!({ "knowledgeBase": knowledge_base })))
}

async fn get_ai_knowledge_base(
    State(state): State<OrdinaryChatState>,
    AxumPath(knowledge_base_id): AxumPath<String>,
) -> AiApiResult<Json<Value>> {
    let connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    let knowledge_base =
        get_knowledge_base(&connection, &knowledge_base_id).map_err(AiApiError::not_found)?;
    Ok(Json(json!({ "knowledgeBase": knowledge_base })))
}

async fn update_ai_knowledge_base(
    State(state): State<OrdinaryChatState>,
    AxumPath(knowledge_base_id): AxumPath<String>,
    Json(payload): Json<UpdateKnowledgeBaseRequest>,
) -> AiApiResult<Json<Value>> {
    let connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    let knowledge_base = update_knowledge_base(&connection, &knowledge_base_id, payload)
        .map_err(AiApiError::bad_request)?;
    Ok(Json(json!({ "knowledgeBase": knowledge_base })))
}

async fn delete_ai_knowledge_base(
    State(state): State<OrdinaryChatState>,
    AxumPath(knowledge_base_id): AxumPath<String>,
) -> AiApiResult<Json<Value>> {
    let connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    let deleted =
        delete_knowledge_base(&connection, &knowledge_base_id).map_err(AiApiError::internal)?;
    Ok(Json(json!({ "deleted": deleted })))
}

async fn import_ai_knowledge_sources(
    State(state): State<OrdinaryChatState>,
    AxumPath(knowledge_base_id): AxumPath<String>,
    Json(payload): Json<ImportKnowledgeSourceRequest>,
) -> AiApiResult<Json<Value>> {
    let mut connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    let sources = import_knowledge_sources(&mut connection, &knowledge_base_id, payload)
        .map_err(AiApiError::bad_request)?;
    let knowledge_base =
        get_knowledge_base(&connection, &knowledge_base_id).map_err(AiApiError::internal)?;
    Ok(Json(
        json!({ "sources": sources, "knowledgeBase": knowledge_base }),
    ))
}

async fn delete_ai_knowledge_source(
    State(state): State<OrdinaryChatState>,
    AxumPath((knowledge_base_id, source_id)): AxumPath<(String, String)>,
) -> AiApiResult<Json<Value>> {
    let connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    let deleted = delete_knowledge_source(&connection, &knowledge_base_id, &source_id)
        .map_err(AiApiError::internal)?;
    Ok(Json(json!({ "deleted": deleted })))
}

async fn rebuild_ai_knowledge_base(
    State(state): State<OrdinaryChatState>,
    AxumPath(knowledge_base_id): AxumPath<String>,
) -> AiApiResult<Json<Value>> {
    let connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    let knowledge_base =
        rebuild_knowledge_base(&connection, &knowledge_base_id).map_err(AiApiError::bad_request)?;
    Ok(Json(json!({ "knowledgeBase": knowledge_base })))
}

async fn search_ai_knowledge(
    State(state): State<OrdinaryChatState>,
    Json(payload): Json<SearchKnowledgeRequest>,
) -> AiApiResult<Json<Value>> {
    let connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    let hits = search_request(&connection, payload).map_err(AiApiError::bad_request)?;
    Ok(Json(json!({ "hits": hits })))
}

async fn create_ai_chat(
    State(state): State<OrdinaryChatState>,
    Json(payload): Json<CreateChatRequest>,
) -> AiApiResult<Json<Value>> {
    let connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    let title = payload
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("新的聊天");
    let chat = create_chat(
        &connection,
        title,
        payload.provider_id.as_deref(),
        payload.model_id.as_deref(),
    )
    .map_err(AiApiError::bad_request)?;
    Ok(Json(json!({ "chat": chat })))
}

async fn get_ai_chat(
    State(state): State<OrdinaryChatState>,
    AxumPath(chat_id): AxumPath<String>,
) -> AiApiResult<Json<Value>> {
    let connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    let chat =
        get_chat(&connection, &chat_id).map_err(|_| AiApiError::not_found("普通聊天不存在"))?;
    Ok(Json(json!({ "chat": chat })))
}

async fn update_ai_chat(
    State(state): State<OrdinaryChatState>,
    AxumPath(chat_id): AxumPath<String>,
    Json(payload): Json<UpdateChatRequest>,
) -> AiApiResult<Json<Value>> {
    let connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    let chat = update_chat_storage(
        &connection,
        &chat_id,
        payload.title.as_deref(),
        payload.provider_id.as_deref(),
        payload.model_id.as_deref(),
        payload.selected_mcp_ids.as_deref(),
        payload.selected_skill_ids.as_deref(),
        payload.selected_knowledge_ids.as_deref(),
    )
    .map_err(AiApiError::bad_request)?;
    Ok(Json(json!({ "chat": chat })))
}

async fn delete_ai_chat(
    State(state): State<OrdinaryChatState>,
    AxumPath(chat_id): AxumPath<String>,
) -> AiApiResult<Json<Value>> {
    let connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    let deleted = delete_chat(&connection, &chat_id).map_err(AiApiError::internal)?;
    Ok(Json(json!({ "deleted": deleted })))
}

async fn delete_ai_chat_turn(
    State(state): State<OrdinaryChatState>,
    AxumPath((chat_id, turn_id)): AxumPath<(String, String)>,
) -> AiApiResult<Json<Value>> {
    let connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    let chat =
        delete_chat_turn(&connection, &chat_id, &turn_id).map_err(AiApiError::bad_request)?;
    Ok(Json(json!({ "chat": chat })))
}

async fn pin_ai_chat(
    State(state): State<OrdinaryChatState>,
    AxumPath(chat_id): AxumPath<String>,
    Json(payload): Json<Value>,
) -> AiApiResult<Json<Value>> {
    let pinned = payload
        .get("pinned")
        .and_then(Value::as_bool)
        .ok_or_else(|| AiApiError::bad_request("pinned 必须是布尔值"))?;
    let connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    let chat = set_chat_pinned(&connection, &chat_id, pinned)
        .map_err(|_| AiApiError::not_found("普通聊天不存在"))?;
    Ok(Json(json!({ "chat": chat })))
}

async fn clear_ai_chat(
    State(state): State<OrdinaryChatState>,
    AxumPath(chat_id): AxumPath<String>,
) -> AiApiResult<Json<Value>> {
    let connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    let chat =
        clear_chat(&connection, &chat_id).map_err(|_| AiApiError::not_found("普通聊天不存在"))?;
    Ok(Json(json!({ "chat": chat })))
}

async fn provider_templates() -> Json<Value> {
    Json(json!({ "templates": PROVIDER_TEMPLATES }))
}

async fn probe_provider_config(
    Json(payload): Json<ProviderProbeRequest>,
) -> AiApiResult<Json<Value>> {
    let (provider, api_key) = temporary_provider_config(payload)?;
    if api_key.is_empty() {
        return Err(AiApiError::bad_request("API Key 不能为空"));
    }
    let message = test_provider(&provider, &api_key)
        .await
        .map_err(AiApiError::bad_request)?;
    Ok(Json(json!({ "ok": true, "message": message })))
}

async fn discover_draft_provider_models(
    Json(payload): Json<ProviderProbeRequest>,
) -> AiApiResult<Json<Value>> {
    let (provider, api_key) = temporary_provider_config(payload)?;
    let models = discover_models(&provider, &api_key)
        .await
        .map_err(AiApiError::bad_request)?;
    Ok(Json(json!({ "models": models })))
}

async fn create_provider(
    State(state): State<OrdinaryChatState>,
    Json(payload): Json<SaveProviderRequest>,
) -> AiApiResult<Json<Value>> {
    let name = require_text(&payload.name, "供应商名称不能为空")?;
    let base_url = validate_base_url(&payload.base_url)?;
    let id = uuid::Uuid::new_v4().to_string();
    let secret_slot = format!("ai-provider:{id}:api-key");
    let models = normalize_model_requests(payload.models.as_deref().unwrap_or(&[]))?;
    let enabled = payload.enabled.unwrap_or(true);
    if payload.is_default == Some(true) && !enabled {
        return Err(AiApiError::bad_request("只有已启用的供应商才能设为默认"));
    }
    let connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    insert_provider(
        &connection,
        &id,
        payload.preset_id.as_deref(),
        name,
        payload.protocol,
        &base_url,
        enabled,
        &secret_slot,
    )
    .map_err(AiApiError::internal)?;
    if let Err(error) = upsert_models(&connection, &id, &models) {
        let _ = connection.execute("DELETE FROM ai_providers WHERE id = ?1", [&id]);
        return Err(AiApiError::internal(error));
    }
    let default_result = if payload.is_default == Some(true) {
        set_default_provider(&connection, &id)
    } else {
        repair_provider_defaults(&connection)
    };
    if let Err(error) = default_result {
        let _ = connection.execute("DELETE FROM ai_providers WHERE id = ?1", [&id]);
        let _ = repair_provider_defaults(&connection);
        return Err(AiApiError::internal(error));
    }
    if let Some(api_key) = payload
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if let Err(error) = state.secrets.set(&secret_slot, api_key) {
            let _ = connection.execute("DELETE FROM ai_providers WHERE id = ?1", [&id]);
            let _ = repair_provider_defaults(&connection);
            return Err(AiApiError::internal(error));
        }
    }
    provider_response(&state, &connection, &id)
}

async fn update_provider(
    State(state): State<OrdinaryChatState>,
    AxumPath(provider_id): AxumPath<String>,
    Json(payload): Json<UpdateProviderRequest>,
) -> AiApiResult<Json<Value>> {
    let connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    let current = get_stored_provider(&connection, &provider_id)
        .map_err(|_| AiApiError::not_found("普通聊天供应商不存在"))?;
    let name = payload
        .name
        .as_deref()
        .map(|value| require_text(value, "供应商名称不能为空"))
        .transpose()?
        .unwrap_or(current.name.as_str());
    let base_url = payload
        .base_url
        .as_deref()
        .map(validate_base_url)
        .transpose()?
        .unwrap_or(current.base_url.clone());
    let enabled = payload.enabled.unwrap_or(current.enabled);
    if payload.is_default == Some(true) && !enabled {
        return Err(AiApiError::bad_request("只有已启用的供应商才能设为默认"));
    }
    connection.execute(
        "UPDATE ai_providers SET preset_id = COALESCE(?2, preset_id), name = ?3, protocol = ?4, base_url = ?5, enabled = ?6, updated_at = ?7 WHERE id = ?1",
        rusqlite::params![provider_id, payload.preset_id, name, payload.protocol.unwrap_or(current.protocol).as_str(), base_url, i64::from(enabled), chrono::Utc::now().to_rfc3339()],
    ).map_err(|error| AiApiError::internal(format!("更新普通聊天供应商失败: {error}")))?;
    if payload.is_default == Some(true) {
        set_default_provider(&connection, &provider_id).map_err(AiApiError::bad_request)?;
    } else {
        repair_provider_defaults(&connection).map_err(AiApiError::internal)?;
    }
    if payload.api_key_touched {
        match payload
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            Some(api_key) => state
                .secrets
                .set(&current.secret_slot, api_key)
                .map_err(AiApiError::internal)?,
            None => state
                .secrets
                .delete(&current.secret_slot)
                .map_err(AiApiError::internal)?,
        }
    }
    provider_response(&state, &connection, &provider_id)
}

async fn delete_provider(
    State(state): State<OrdinaryChatState>,
    AxumPath(provider_id): AxumPath<String>,
) -> AiApiResult<Json<Value>> {
    let connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    let provider = get_stored_provider(&connection, &provider_id)
        .map_err(|_| AiApiError::not_found("普通聊天供应商不存在"))?;
    let changed = connection
        .execute("DELETE FROM ai_providers WHERE id = ?1", [&provider_id])
        .map_err(|error| AiApiError::internal(format!("删除普通聊天供应商失败: {error}")))?;
    if changed > 0 {
        repair_provider_defaults(&connection).map_err(AiApiError::internal)?;
        state
            .secrets
            .delete(&provider.secret_slot)
            .map_err(AiApiError::internal)?;
    }
    Ok(Json(json!({ "deleted": changed > 0 })))
}

async fn test_provider_config(
    State(state): State<OrdinaryChatState>,
    AxumPath(provider_id): AxumPath<String>,
) -> AiApiResult<Json<Value>> {
    let connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    let provider = get_stored_provider(&connection, &provider_id)
        .map_err(|_| AiApiError::not_found("普通聊天供应商不存在"))?;
    let api_key = state
        .secrets
        .get(&provider.secret_slot)
        .map_err(AiApiError::bad_request)?;
    let message = test_provider(&provider, &api_key)
        .await
        .map_err(AiApiError::bad_request)?;
    Ok(Json(json!({ "ok": true, "message": message })))
}

async fn get_provider_api_key(
    State(state): State<OrdinaryChatState>,
    AxumPath(provider_id): AxumPath<String>,
) -> AiApiResult<Response> {
    let connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    let provider = get_stored_provider(&connection, &provider_id)
        .map_err(|_| AiApiError::not_found("普通聊天供应商不存在"))?;
    let api_key = state
        .secrets
        .get(&provider.secret_slot)
        .map_err(AiApiError::bad_request)?;
    Ok((
        [
            (header::CACHE_CONTROL, "no-store"),
            (header::PRAGMA, "no-cache"),
        ],
        Json(json!({ "apiKey": api_key })),
    )
        .into_response())
}

async fn refresh_provider_models(
    State(state): State<OrdinaryChatState>,
    AxumPath(provider_id): AxumPath<String>,
) -> AiApiResult<Json<Value>> {
    let connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    let provider = get_stored_provider(&connection, &provider_id)
        .map_err(|_| AiApiError::not_found("普通聊天供应商不存在"))?;
    let api_key = optional_provider_api_key(&state, &provider.secret_slot)?;
    let models = discover_models(&provider, &api_key)
        .await
        .map_err(AiApiError::bad_request)?;
    let has_existing = !list_models(&connection, &provider_id)
        .map_err(AiApiError::internal)?
        .is_empty();
    for (index, model) in models.iter().enumerate() {
        upsert_model(
            &connection,
            &provider_id,
            &model.model_id,
            &model.display_name,
            true,
            !has_existing && index == 0,
            &json!({}),
        )
        .map_err(AiApiError::internal)?;
    }
    Ok(Json(
        json!({ "models": list_models(&connection, &provider_id).map_err(AiApiError::internal)? }),
    ))
}

async fn discover_saved_provider_models(
    State(state): State<OrdinaryChatState>,
    AxumPath(provider_id): AxumPath<String>,
) -> AiApiResult<Json<Value>> {
    let connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    let provider = get_stored_provider(&connection, &provider_id)
        .map_err(|_| AiApiError::not_found("普通聊天供应商不存在"))?;
    let api_key = optional_provider_api_key(&state, &provider.secret_slot)?;
    let models = discover_models(&provider, &api_key)
        .await
        .map_err(AiApiError::bad_request)?;
    Ok(Json(json!({ "models": models })))
}

async fn create_models_batch(
    State(state): State<OrdinaryChatState>,
    AxumPath(provider_id): AxumPath<String>,
    Json(payload): Json<BatchSaveModelsRequest>,
) -> AiApiResult<Json<Value>> {
    let connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    get_stored_provider(&connection, &provider_id)
        .map_err(|_| AiApiError::not_found("普通聊天供应商不存在"))?;
    let models = normalize_model_requests(&payload.models)?;
    if models.is_empty() {
        return Err(AiApiError::bad_request("至少选择一个模型"));
    }
    upsert_models(&connection, &provider_id, &models).map_err(AiApiError::internal)?;
    Ok(Json(
        json!({ "models": list_models(&connection, &provider_id).map_err(AiApiError::internal)? }),
    ))
}

async fn create_model(
    State(state): State<OrdinaryChatState>,
    AxumPath(provider_id): AxumPath<String>,
    Json(payload): Json<SaveModelRequest>,
) -> AiApiResult<Json<Value>> {
    let connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    get_stored_provider(&connection, &provider_id)
        .map_err(|_| AiApiError::not_found("普通聊天供应商不存在"))?;
    let model_id = require_text(&payload.model_id, "模型 ID 不能为空")?;
    let display_name = payload
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(model_id);
    upsert_model(
        &connection,
        &provider_id,
        model_id,
        display_name,
        payload.enabled.unwrap_or(true),
        payload.is_default.unwrap_or(false),
        payload.capabilities.as_ref().unwrap_or(&json!({})),
    )
    .map_err(AiApiError::internal)?;
    Ok(Json(
        json!({ "models": list_models(&connection, &provider_id).map_err(AiApiError::internal)? }),
    ))
}

async fn update_model(
    State(state): State<OrdinaryChatState>,
    AxumPath(model_id): AxumPath<String>,
    Json(payload): Json<UpdateModelRequest>,
) -> AiApiResult<Json<Value>> {
    let connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    let row: Option<(String, String, String, bool, bool, Value)> = connection.query_row(
        "SELECT provider_id, model_id, display_name, enabled, is_default, capabilities_json FROM ai_models WHERE id = ?1",
        [&model_id],
        |row| {
            let capabilities: String = row.get(5)?;
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get::<_, i64>(3)? != 0, row.get::<_, i64>(4)? != 0, serde_json::from_str(&capabilities).unwrap_or_else(|_| json!({}))))
        },
    ).optional().map_err(|error| AiApiError::internal(format!("读取普通聊天模型失败: {error}")))?;
    let (
        provider_id,
        api_model_id,
        current_name,
        current_enabled,
        current_default,
        current_capabilities,
    ) = row.ok_or_else(|| AiApiError::not_found("普通聊天模型不存在"))?;
    upsert_model(
        &connection,
        &provider_id,
        &api_model_id,
        payload
            .display_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(&current_name),
        payload.enabled.unwrap_or(current_enabled),
        payload
            .is_default
            .unwrap_or(current_default && payload.enabled.unwrap_or(current_enabled)),
        payload
            .capabilities
            .as_ref()
            .unwrap_or(&current_capabilities),
    )
    .map_err(AiApiError::internal)?;
    Ok(Json(
        json!({ "models": list_models(&connection, &provider_id).map_err(AiApiError::internal)? }),
    ))
}

async fn delete_model(
    State(state): State<OrdinaryChatState>,
    AxumPath(model_id): AxumPath<String>,
) -> AiApiResult<Json<Value>> {
    let connection =
        open_initialized_database(&state.database_path).map_err(AiApiError::internal)?;
    let deleted = delete_model_storage(&connection, &model_id).map_err(AiApiError::internal)?;
    Ok(Json(json!({ "deleted": deleted })))
}

fn provider_response(
    state: &OrdinaryChatState,
    connection: &rusqlite::Connection,
    provider_id: &str,
) -> AiApiResult<Json<Value>> {
    let provider = list_providers(connection, |slot| state.secrets.has(slot))
        .map_err(AiApiError::internal)?
        .into_iter()
        .find(|provider| provider.id == provider_id)
        .ok_or_else(|| AiApiError::not_found("普通聊天供应商不存在"))?;
    Ok(Json(json!({ "provider": provider })))
}

fn temporary_provider_config(
    payload: ProviderProbeRequest,
) -> AiApiResult<(StoredProvider, String)> {
    let base_url = validate_base_url(&payload.base_url)?;
    let api_key = payload.api_key.trim().to_string();
    Ok((
        StoredProvider {
            name: "临时供应商".to_string(),
            protocol: payload.protocol,
            base_url,
            enabled: true,
            secret_slot: String::new(),
        },
        api_key,
    ))
}

fn optional_provider_api_key(state: &OrdinaryChatState, secret_slot: &str) -> AiApiResult<String> {
    if !state
        .secrets
        .has(secret_slot)
        .map_err(AiApiError::bad_request)?
    {
        return Ok(String::new());
    }
    state
        .secrets
        .get(secret_slot)
        .map_err(AiApiError::bad_request)
}

fn normalize_model_requests(payloads: &[SaveModelRequest]) -> AiApiResult<Vec<ModelWrite>> {
    if payloads.len() > 500 {
        return Err(AiApiError::bad_request("单次最多添加 500 个模型"));
    }
    let mut model_ids = HashSet::new();
    let mut default_count = 0usize;
    let mut models = Vec::with_capacity(payloads.len());
    for payload in payloads {
        let model_id = require_text(&payload.model_id, "模型 ID 不能为空")?.to_string();
        if !model_ids.insert(model_id.to_lowercase()) {
            return Err(AiApiError::bad_request(format!("模型 ID 重复：{model_id}")));
        }
        let display_name = payload
            .display_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(&model_id)
            .to_string();
        let is_default = payload.is_default.unwrap_or(false);
        default_count += usize::from(is_default);
        models.push(ModelWrite {
            model_id,
            display_name,
            enabled: payload.enabled.unwrap_or(true),
            is_default,
            capabilities: payload.capabilities.clone().unwrap_or_else(|| json!({})),
        });
    }
    if default_count > 1 {
        return Err(AiApiError::bad_request("只能设置一个默认模型"));
    }
    Ok(models)
}

fn require_text<'a>(value: &'a str, message: &str) -> AiApiResult<&'a str> {
    let value = value.trim();
    if value.is_empty() {
        Err(AiApiError::bad_request(message))
    } else {
        Ok(value)
    }
}

fn validate_base_url(value: &str) -> AiApiResult<String> {
    let value = require_text(value, "请求地址不能为空")?;
    let url =
        url::Url::parse(value).map_err(|_| AiApiError::bad_request("请求地址不是合法 URL"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(AiApiError::bad_request("请求地址必须使用 http 或 https"));
    }
    Ok(value.trim_end_matches('/').to_string())
}

use rusqlite::OptionalExtension;

#[cfg(test)]
mod tests {
    use super::OrdinaryChatService;
    use axum::{
        body::{to_bytes, Body},
        response::IntoResponse,
        routing::get,
        Json, Router,
    };
    use serde_json::{json, Value};
    use std::{fs, path::PathBuf};
    use tower::ServiceExt;

    #[tokio::test]
    async fn draft_model_discovery_does_not_persist_provider() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(
                listener,
                Router::new().route("/v1/models", get(mock_models)),
            )
            .await
            .unwrap();
        });
        let root = test_directory("draft-model-discovery");
        let service = OrdinaryChatService::new(root.clone());
        let response = super::router(service.clone())
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri("/api/ai/providers/models/discover")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "protocol": "openai_chat",
                            "baseUrl": format!("http://{address}/v1"),
                            "apiKey": "test-key"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), 200);
        let payload: Value = serde_json::from_slice(
            &to_bytes(response.into_body(), 2 * 1024 * 1024)
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(payload["models"].as_array().unwrap().len(), 2);

        let bootstrap = super::router(service)
            .oneshot(
                axum::http::Request::builder()
                    .method("GET")
                    .uri("/api/ai/bootstrap")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let payload: Value = serde_json::from_slice(
            &to_bytes(bootstrap.into_body(), 2 * 1024 * 1024)
                .await
                .unwrap(),
        )
        .unwrap();
        assert!(payload["providers"].as_array().unwrap().is_empty());
        remove_test_directory(root);
    }

    #[tokio::test]
    async fn creating_provider_persists_selected_models_and_one_default() {
        let root = test_directory("create-provider-models");
        let response = super::router(OrdinaryChatService::new(root.clone()))
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri("/api/ai/providers")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "name": "测试供应商",
                            "protocol": "openai_chat",
                            "baseUrl": "https://api.example.com/v1",
                            "models": [
                                { "modelId": "model-a", "displayName": "模型 A" },
                                { "modelId": "model-b", "displayName": "模型 B" }
                            ]
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), 200);
        let payload: Value = serde_json::from_slice(
            &to_bytes(response.into_body(), 2 * 1024 * 1024)
                .await
                .unwrap(),
        )
        .unwrap();
        let models = payload["provider"]["models"].as_array().unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!(
            models
                .iter()
                .filter(|model| model["isDefault"] == true)
                .count(),
            1
        );
        remove_test_directory(root);
    }

    #[tokio::test]
    async fn saved_minimax_token_plan_without_api_key_discovers_documented_models() {
        let root = test_directory("saved-minimax-token-plan-models");
        let service = OrdinaryChatService::new(root.clone());
        let create_response = super::router(service.clone())
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri("/api/ai/providers")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "presetId": "minimax-token-plan",
                            "name": "MiniMax Token Plan",
                            "protocol": "anthropic_messages",
                            "baseUrl": "https://api.minimaxi.com/anthropic"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(create_response.status(), 200);
        let create_payload: Value = serde_json::from_slice(
            &to_bytes(create_response.into_body(), 2 * 1024 * 1024)
                .await
                .unwrap(),
        )
        .unwrap();
        let provider_id = create_payload["provider"]["id"].as_str().unwrap();

        let response = super::router(service)
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri(format!("/api/ai/providers/{provider_id}/models/discover"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), 200);
        let payload: Value = serde_json::from_slice(
            &to_bytes(response.into_body(), 2 * 1024 * 1024)
                .await
                .unwrap(),
        )
        .unwrap();
        let models = payload["models"].as_array().unwrap();
        assert_eq!(models.len(), 8);
        assert_eq!(models[0]["modelId"], "MiniMax-M3");
        assert!(models
            .iter()
            .any(|model| model["modelId"] == "MiniMax-M2.7-highspeed"));
        remove_test_directory(root);
    }

    #[tokio::test]
    async fn saved_provider_api_key_is_revealed_only_by_explicit_no_store_endpoint() {
        let root = test_directory("provider-api-key-reveal");
        let service = OrdinaryChatService::new(root.clone());
        let create_response = super::router(service.clone())
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri("/api/ai/providers")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "name": "测试供应商",
                            "protocol": "openai_chat",
                            "baseUrl": "https://api.example.com/v1",
                            "apiKey": "test-key"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(create_response.status(), 200);
        let create_payload: Value = serde_json::from_slice(
            &to_bytes(create_response.into_body(), 2 * 1024 * 1024)
                .await
                .unwrap(),
        )
        .unwrap();
        let provider_id = create_payload["provider"]["id"].as_str().unwrap();

        let response = super::router(service)
            .oneshot(
                axum::http::Request::builder()
                    .method("GET")
                    .uri(format!("/api/ai/providers/{provider_id}/api-key"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["cache-control"], "no-store");
        let payload: Value = serde_json::from_slice(
            &to_bytes(response.into_body(), 2 * 1024 * 1024)
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(payload["apiKey"], "test-key");
        remove_test_directory(root);
    }

    async fn mock_models() -> impl IntoResponse {
        Json(json!({
            "data": [
                { "id": "model-b" },
                { "id": "model-a", "display_name": "模型 A" }
            ]
        }))
    }

    fn test_directory(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("codem-{label}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn remove_test_directory(path: PathBuf) {
        let _ = fs::remove_dir_all(path);
    }
}
