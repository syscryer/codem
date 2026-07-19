use super::types::{
    AiChatDetail, AiChatMessage, AiChatModelPreference, AiChatSummary, AiModelSummary, AiProtocol,
    AiProviderSummary, AiToolCallRecord, ModelMessage, ProviderToolCall, StoredModel,
    StoredProvider,
};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::{collections::BTreeMap, path::Path};

pub(crate) struct TurnReplay {
    pub user_content: String,
    pub content_blocks: Value,
    pub provider_id: String,
    pub model_id: String,
}

#[derive(Clone, Debug)]
pub(crate) struct ModelWrite {
    pub model_id: String,
    pub display_name: String,
    pub enabled: bool,
    pub is_default: bool,
    pub capabilities: Value,
}

pub(crate) fn open_initialized_database(path: &Path) -> Result<Connection, String> {
    let connection =
        Connection::open(path).map_err(|error| format!("打开普通聊天数据库失败: {error}"))?;
    initialize_database(&connection)?;
    Ok(connection)
}

pub(crate) fn initialize_database(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS ai_providers (
              id TEXT PRIMARY KEY,
              preset_id TEXT,
              name TEXT NOT NULL,
              protocol TEXT NOT NULL,
              base_url TEXT NOT NULL,
              enabled INTEGER NOT NULL DEFAULT 1,
              is_default INTEGER NOT NULL DEFAULT 0,
              secret_slot TEXT NOT NULL UNIQUE,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ai_models (
              id TEXT PRIMARY KEY,
              provider_id TEXT NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
              model_id TEXT NOT NULL,
              display_name TEXT NOT NULL,
              enabled INTEGER NOT NULL DEFAULT 1,
              is_default INTEGER NOT NULL DEFAULT 0,
              capabilities_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE(provider_id, model_id)
            );

            CREATE INDEX IF NOT EXISTS idx_ai_models_provider
              ON ai_models(provider_id, enabled DESC, display_name ASC);

            CREATE TABLE IF NOT EXISTS ai_chats (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              custom_title INTEGER NOT NULL DEFAULT 0,
              provider_id TEXT REFERENCES ai_providers(id) ON DELETE SET NULL,
              model_id TEXT REFERENCES ai_models(id) ON DELETE SET NULL,
              selected_mcp_json TEXT NOT NULL DEFAULT '[]',
              selected_skills_json TEXT NOT NULL DEFAULT '[]',
              selected_knowledge_json TEXT NOT NULL DEFAULT '[]',
              model_preferences_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              pinned_at TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_ai_chats_updated_at
              ON ai_chats(updated_at DESC);

            CREATE TABLE IF NOT EXISTS ai_messages (
              id TEXT PRIMARY KEY,
              chat_id TEXT NOT NULL REFERENCES ai_chats(id) ON DELETE CASCADE,
              turn_id TEXT NOT NULL,
              item_sort INTEGER NOT NULL,
              role TEXT NOT NULL,
              content TEXT NOT NULL,
              reasoning_content TEXT NOT NULL DEFAULT '',
              content_blocks_json TEXT NOT NULL DEFAULT '[]',
              provider_id TEXT,
              provider_name TEXT,
              model_id TEXT,
              model_name TEXT,
              status TEXT NOT NULL,
              error_message TEXT,
              usage_json TEXT,
              citations_json TEXT NOT NULL DEFAULT '[]',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_ai_messages_chat_turn
              ON ai_messages(chat_id, created_at ASC, item_sort ASC);

            CREATE TABLE IF NOT EXISTS ai_tool_calls (
              id TEXT PRIMARY KEY,
              chat_id TEXT NOT NULL REFERENCES ai_chats(id) ON DELETE CASCADE,
              turn_id TEXT NOT NULL,
              tool_call_id TEXT NOT NULL,
              server_id TEXT,
              name TEXT NOT NULL,
              input_json TEXT NOT NULL DEFAULT '{}',
              result_json TEXT,
              status TEXT NOT NULL,
              risk TEXT NOT NULL DEFAULT 'safe',
              approval_json TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_tool_calls_chat_call
              ON ai_tool_calls(chat_id, tool_call_id);

            CREATE TABLE IF NOT EXISTS ai_knowledge_bases (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              description TEXT NOT NULL DEFAULT '',
              embedding_provider_id TEXT,
              embedding_model_id TEXT,
              chunk_size INTEGER NOT NULL DEFAULT 1000,
              chunk_overlap INTEGER NOT NULL DEFAULT 150,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ai_knowledge_sources (
              id TEXT PRIMARY KEY,
              knowledge_base_id TEXT NOT NULL REFERENCES ai_knowledge_bases(id) ON DELETE CASCADE,
              kind TEXT NOT NULL,
              name TEXT NOT NULL,
              source_path TEXT,
              content_hash TEXT NOT NULL,
              status TEXT NOT NULL,
              error_message TEXT,
              chunk_count INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ai_knowledge_chunks (
              id TEXT PRIMARY KEY,
              knowledge_base_id TEXT NOT NULL REFERENCES ai_knowledge_bases(id) ON DELETE CASCADE,
              source_id TEXT NOT NULL REFERENCES ai_knowledge_sources(id) ON DELETE CASCADE,
              chunk_index INTEGER NOT NULL,
              content TEXT NOT NULL,
              token_estimate INTEGER NOT NULL,
              embedding_json TEXT,
              metadata_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL,
              UNIQUE(source_id, chunk_index)
            );

            CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_base
              ON ai_knowledge_chunks(knowledge_base_id, source_id, chunk_index);
            "#,
        )
        .map_err(|error| format!("初始化普通聊天数据库失败: {error}"))?;
    ensure_column(
        connection,
        "ai_providers",
        "is_default",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    repair_provider_defaults(connection)?;
    connection
        .execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_providers_single_default
             ON ai_providers(is_default) WHERE is_default = 1",
            [],
        )
        .map_err(sql_error)?;
    ensure_column(
        connection,
        "ai_messages",
        "reasoning_content",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_column(connection, "ai_messages", "error_message", "TEXT")?;
    ensure_column(
        connection,
        "ai_chats",
        "model_preferences_json",
        "TEXT NOT NULL DEFAULT '{}'",
    )?;
    repair_model_defaults(connection)
}

fn ensure_column(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(sql_error)?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    if columns.iter().any(|item| item == column) {
        return Ok(());
    }
    connection
        .execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
            [],
        )
        .map_err(sql_error)?;
    Ok(())
}

pub(crate) fn list_providers(
    connection: &Connection,
    has_secret: impl Fn(&str) -> Result<bool, String>,
) -> Result<Vec<AiProviderSummary>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, preset_id, name, protocol, base_url, enabled, is_default, secret_slot, created_at, updated_at
             FROM ai_providers ORDER BY is_default DESC, enabled DESC, name COLLATE NOCASE ASC",
        )
        .map_err(|error| format!("读取普通聊天供应商失败: {error}"))?;
    let mut rows = statement
        .query([])
        .map_err(|error| format!("读取普通聊天供应商失败: {error}"))?;
    let mut providers = Vec::new();
    while let Some(row) = rows
        .next()
        .map_err(|error| format!("读取普通聊天供应商失败: {error}"))?
    {
        let id: String = row.get(0).map_err(sql_error)?;
        let protocol_text: String = row.get(3).map_err(sql_error)?;
        let secret_slot: String = row.get(7).map_err(sql_error)?;
        let protocol =
            AiProtocol::parse(&protocol_text).ok_or_else(|| format!("供应商 {id} 的协议无效"))?;
        providers.push(AiProviderSummary {
            models: list_models(connection, &id)?,
            id,
            preset_id: row.get(1).map_err(sql_error)?,
            name: row.get(2).map_err(sql_error)?,
            protocol,
            base_url: row.get(4).map_err(sql_error)?,
            enabled: row.get::<_, i64>(5).map_err(sql_error)? != 0,
            is_default: row.get::<_, i64>(6).map_err(sql_error)? != 0,
            api_key_saved: has_secret(&secret_slot)?,
            created_at: row.get(8).map_err(sql_error)?,
            updated_at: row.get(9).map_err(sql_error)?,
        });
    }
    Ok(providers)
}

pub(crate) fn get_stored_provider(
    connection: &Connection,
    provider_id: &str,
) -> Result<StoredProvider, String> {
    connection
        .query_row(
            "SELECT name, protocol, base_url, enabled, secret_slot FROM ai_providers WHERE id = ?1",
            [provider_id],
            |row| {
                let protocol_text: String = row.get(1)?;
                Ok((
                    row.get::<_, String>(0)?,
                    protocol_text,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)? != 0,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .optional()
        .map_err(sql_error)?
        .ok_or_else(|| "普通聊天供应商不存在".to_string())
        .and_then(|(name, protocol, base_url, enabled, secret_slot)| {
            Ok(StoredProvider {
                name,
                protocol: AiProtocol::parse(&protocol)
                    .ok_or_else(|| "普通聊天供应商协议无效".to_string())?,
                base_url,
                enabled,
                secret_slot,
            })
        })
}

pub(crate) fn get_stored_model(
    connection: &Connection,
    provider_id: &str,
    model_row_id: &str,
) -> Result<StoredModel, String> {
    connection
        .query_row(
            "SELECT id, model_id, display_name, capabilities_json
             FROM ai_models WHERE id = ?1 AND provider_id = ?2 AND enabled = 1",
            params![model_row_id, provider_id],
            |row| {
                let capabilities: String = row.get(3)?;
                Ok(StoredModel {
                    id: row.get(0)?,
                    model_id: row.get(1)?,
                    display_name: row.get(2)?,
                    capabilities: serde_json::from_str(&capabilities).unwrap_or_else(|_| json!({})),
                })
            },
        )
        .optional()
        .map_err(sql_error)?
        .ok_or_else(|| "普通聊天模型不存在、未启用或不属于当前供应商".to_string())
}

pub(crate) fn insert_provider(
    connection: &Connection,
    id: &str,
    preset_id: Option<&str>,
    name: &str,
    protocol: AiProtocol,
    base_url: &str,
    enabled: bool,
    secret_slot: &str,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    connection
        .execute(
            "INSERT INTO ai_providers(id, preset_id, name, protocol, base_url, enabled, secret_slot, created_at, updated_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![id, preset_id, name, protocol.as_str(), base_url, i64::from(enabled), secret_slot, now],
        )
        .map_err(|error| format!("保存普通聊天供应商失败: {error}"))?;
    Ok(())
}

pub(crate) fn list_models(
    connection: &Connection,
    provider_id: &str,
) -> Result<Vec<AiModelSummary>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, provider_id, model_id, display_name, enabled, is_default, capabilities_json, created_at, updated_at
             FROM ai_models WHERE provider_id = ?1 ORDER BY is_default DESC, enabled DESC, display_name COLLATE NOCASE ASC",
        )
        .map_err(sql_error)?;
    let rows = statement
        .query_map([provider_id], |row| {
            let capabilities_text: String = row.get(6)?;
            Ok(AiModelSummary {
                id: row.get(0)?,
                provider_id: row.get(1)?,
                model_id: row.get(2)?,
                display_name: row.get(3)?,
                enabled: row.get::<_, i64>(4)? != 0,
                is_default: row.get::<_, i64>(5)? != 0,
                capabilities: serde_json::from_str(&capabilities_text)
                    .unwrap_or_else(|_| json!({})),
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(sql_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sql_error)
}

pub(crate) fn upsert_model(
    connection: &Connection,
    provider_id: &str,
    model_id: &str,
    display_name: &str,
    enabled: bool,
    is_default: bool,
    capabilities: &Value,
) -> Result<(), String> {
    upsert_models(
        connection,
        provider_id,
        &[ModelWrite {
            model_id: model_id.to_string(),
            display_name: display_name.to_string(),
            enabled,
            is_default,
            capabilities: capabilities.clone(),
        }],
    )
}

pub(crate) fn set_default_provider(
    connection: &Connection,
    provider_id: &str,
) -> Result<(), String> {
    let enabled = connection
        .query_row(
            "SELECT enabled FROM ai_providers WHERE id = ?1",
            [provider_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(sql_error)?
        .ok_or_else(|| "普通聊天供应商不存在".to_string())?;
    if enabled == 0 {
        return Err("只有已启用的供应商才能设为默认".to_string());
    }
    let transaction = connection.unchecked_transaction().map_err(sql_error)?;
    let now = Utc::now().to_rfc3339();
    transaction
        .execute(
            "UPDATE ai_providers SET is_default = 0, updated_at = ?1 WHERE is_default = 1",
            [&now],
        )
        .map_err(sql_error)?;
    transaction
        .execute(
            "UPDATE ai_providers SET is_default = 1, updated_at = ?2 WHERE id = ?1",
            params![provider_id, now],
        )
        .map_err(sql_error)?;
    transaction.commit().map_err(sql_error)
}

pub(crate) fn repair_provider_defaults(connection: &Connection) -> Result<(), String> {
    let preferred_id = connection
        .query_row(
            "SELECT id FROM ai_providers
             WHERE enabled = 1
             ORDER BY is_default DESC, created_at ASC, name COLLATE NOCASE ASC, id ASC
             LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(sql_error)?;
    let transaction = connection.unchecked_transaction().map_err(sql_error)?;
    let now = Utc::now().to_rfc3339();
    transaction
        .execute(
            "UPDATE ai_providers SET is_default = 0, updated_at = ?1 WHERE is_default = 1",
            [&now],
        )
        .map_err(sql_error)?;
    if let Some(preferred_id) = preferred_id {
        transaction
            .execute(
                "UPDATE ai_providers SET is_default = 1, updated_at = ?2 WHERE id = ?1",
                params![preferred_id, now],
            )
            .map_err(sql_error)?;
    }
    transaction.commit().map_err(sql_error)
}

pub(crate) fn upsert_models(
    connection: &Connection,
    provider_id: &str,
    models: &[ModelWrite],
) -> Result<(), String> {
    if models.is_empty() {
        return Ok(());
    }
    let transaction = connection.unchecked_transaction().map_err(sql_error)?;
    for model in models {
        upsert_model_row(&transaction, provider_id, model)?;
    }
    normalize_default_model(&transaction, provider_id)?;
    transaction.commit().map_err(sql_error)?;
    Ok(())
}

fn upsert_model_row(
    connection: &Connection,
    provider_id: &str,
    model: &ModelWrite,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    let existing_id: Option<String> = connection
        .query_row(
            "SELECT id FROM ai_models WHERE provider_id = ?1 AND model_id = ?2",
            params![provider_id, &model.model_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(sql_error)?;
    let id = existing_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let enabled = model.enabled || model.is_default;
    if model.is_default {
        connection
            .execute(
                "UPDATE ai_models SET is_default = 0, updated_at = ?2 WHERE provider_id = ?1",
                params![provider_id, now],
            )
            .map_err(sql_error)?;
    }
    connection
        .execute(
            "INSERT INTO ai_models(id, provider_id, model_id, display_name, enabled, is_default, capabilities_json, created_at, updated_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
             ON CONFLICT(provider_id, model_id) DO UPDATE SET
               display_name = excluded.display_name,
               enabled = excluded.enabled,
               is_default = excluded.is_default,
               capabilities_json = excluded.capabilities_json,
               updated_at = excluded.updated_at",
            params![id, provider_id, &model.model_id, &model.display_name, i64::from(enabled), i64::from(model.is_default), model.capabilities.to_string(), now],
        )
        .map_err(|error| format!("保存普通聊天模型失败: {error}"))?;
    Ok(())
}

pub(crate) fn delete_model(connection: &Connection, model_id: &str) -> Result<bool, String> {
    let transaction = connection.unchecked_transaction().map_err(sql_error)?;
    let provider_id = transaction
        .query_row(
            "SELECT provider_id FROM ai_models WHERE id = ?1",
            [model_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(sql_error)?;
    let Some(provider_id) = provider_id else {
        return Ok(false);
    };
    transaction
        .execute("DELETE FROM ai_models WHERE id = ?1", [model_id])
        .map_err(|error| format!("删除普通聊天模型失败: {error}"))?;
    normalize_default_model(&transaction, &provider_id)?;
    transaction.commit().map_err(sql_error)?;
    Ok(true)
}

fn repair_model_defaults(connection: &Connection) -> Result<(), String> {
    let mut statement = connection
        .prepare("SELECT DISTINCT provider_id FROM ai_models")
        .map_err(sql_error)?;
    let provider_ids = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    drop(statement);
    for provider_id in provider_ids {
        normalize_default_model(connection, &provider_id)?;
    }
    Ok(())
}

fn normalize_default_model(connection: &Connection, provider_id: &str) -> Result<(), String> {
    let preferred_id = connection
        .query_row(
            "SELECT id FROM ai_models
             WHERE provider_id = ?1 AND enabled = 1
             ORDER BY is_default DESC, created_at ASC, display_name COLLATE NOCASE ASC, id ASC
             LIMIT 1",
            [provider_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(sql_error)?;
    let now = Utc::now().to_rfc3339();
    match preferred_id {
        Some(preferred_id) => connection
            .execute(
                "UPDATE ai_models
                 SET is_default = CASE WHEN id = ?2 THEN 1 ELSE 0 END, updated_at = ?3
                 WHERE provider_id = ?1
                   AND is_default <> CASE WHEN id = ?2 THEN 1 ELSE 0 END",
                params![provider_id, preferred_id, now],
            )
            .map(|_| ())
            .map_err(sql_error),
        None => connection
            .execute(
                "UPDATE ai_models SET is_default = 0, updated_at = ?2
                 WHERE provider_id = ?1 AND is_default <> 0",
                params![provider_id, now],
            )
            .map(|_| ())
            .map_err(sql_error),
    }
}

pub(crate) fn list_chats(connection: &Connection) -> Result<Vec<AiChatSummary>, String> {
    let mut statement = connection
        .prepare(
            "SELECT
               c.id, c.title, c.provider_id, c.model_id,
               c.selected_mcp_json, c.selected_skills_json, c.selected_knowledge_json,
               c.model_preferences_json,
               c.created_at, c.updated_at, c.pinned_at,
               COUNT(m.id),
               (SELECT content FROM ai_messages latest WHERE latest.chat_id = c.id AND TRIM(latest.content) <> '' ORDER BY latest.created_at DESC, latest.item_sort DESC LIMIT 1)
             FROM ai_chats c
             LEFT JOIN ai_messages m ON m.chat_id = c.id
             GROUP BY c.id
             ORDER BY (c.pinned_at IS NOT NULL) DESC, c.pinned_at DESC, c.updated_at DESC",
        )
        .map_err(sql_error)?;
    let rows = statement
        .query_map([], chat_summary_from_row)
        .map_err(sql_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sql_error)
}

pub(crate) fn list_model_messages(
    connection: &Connection,
    chat_id: &str,
) -> Result<Vec<ModelMessage>, String> {
    let mut statement = connection
        .prepare(
            "SELECT turn_id, role, content, content_blocks_json FROM ai_messages
             WHERE chat_id = ?1 AND role IN ('user', 'assistant') AND status <> 'error'
               AND NOT (role = 'assistant' AND TRIM(content) = '')
             ORDER BY created_at ASC, item_sort ASC",
        )
        .map_err(sql_error)?;
    let rows = statement
        .query_map([chat_id], |row| {
            let content_blocks: String = row.get(3)?;
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                serde_json::from_str(&content_blocks).unwrap_or_else(|_| json!([])),
            ))
        })
        .map_err(sql_error)?;
    let rows = rows.collect::<Result<Vec<_>, _>>().map_err(sql_error)?;
    let tool_calls = list_tool_calls(connection, chat_id)?;
    let mut rebuilt = Vec::new();
    for (turn_id, role, content, content_blocks) in rows {
        let message = ModelMessage {
            role: role.clone(),
            content,
            content_blocks,
            tool_calls: Vec::new(),
            tool_call_id: None,
            tool_name: None,
            tool_result_is_error: false,
        };
        if role != "assistant" {
            rebuilt.push(message);
            continue;
        }
        let turn_calls = tool_calls
            .iter()
            .filter(|call| call.turn_id == turn_id && call.result.is_some())
            .collect::<Vec<_>>();
        if turn_calls.is_empty() {
            rebuilt.push(message);
            continue;
        }
        rebuilt.push(ModelMessage {
            role: "assistant".to_string(),
            content: String::new(),
            content_blocks: Value::Array(Vec::new()),
            tool_calls: turn_calls
                .iter()
                .map(|call| ProviderToolCall {
                    id: call.tool_call_id.clone(),
                    name: call.name.clone(),
                    arguments: call.input.clone(),
                })
                .collect(),
            tool_call_id: None,
            tool_name: None,
            tool_result_is_error: false,
        });
        for call in &turn_calls {
            rebuilt.push(ModelMessage {
                role: "tool".to_string(),
                content: tool_result_text(call.result.as_ref()),
                content_blocks: Value::Array(Vec::new()),
                tool_calls: Vec::new(),
                tool_call_id: Some(call.tool_call_id.clone()),
                tool_name: Some(call.name.clone()),
                tool_result_is_error: call.status == "error" || call.status == "rejected",
            });
        }
        rebuilt.push(message);
    }
    Ok(rebuilt)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn begin_chat_turn(
    connection: &Connection,
    chat_id: &str,
    turn_id: &str,
    user_content: &str,
    content_blocks: &Value,
    provider: &StoredProvider,
    provider_id: &str,
    model: &StoredModel,
    replace_from_turn_id: Option<&str>,
) -> Result<String, String> {
    get_chat(connection, chat_id)?;
    let transaction = connection.unchecked_transaction().map_err(sql_error)?;
    let now = Utc::now().to_rfc3339();
    if let Some(replace_turn_id) = replace_from_turn_id {
        let cutoff_rowid: i64 = transaction
            .query_row(
                "SELECT rowid FROM ai_messages
                 WHERE chat_id = ?1 AND turn_id = ?2 AND role = 'user' LIMIT 1",
                params![chat_id, replace_turn_id],
                |row| row.get(0),
            )
            .map_err(|_| "要重新发送的普通聊天消息不存在".to_string())?;
        transaction
            .execute(
                "DELETE FROM ai_tool_calls WHERE chat_id = ?1 AND turn_id IN (
                   SELECT DISTINCT turn_id FROM ai_messages WHERE chat_id = ?1 AND rowid >= ?2
                 )",
                params![chat_id, cutoff_rowid],
            )
            .map_err(sql_error)?;
        transaction
            .execute(
                "DELETE FROM ai_messages WHERE chat_id = ?1 AND rowid >= ?2",
                params![chat_id, cutoff_rowid],
            )
            .map_err(sql_error)?;
    }
    transaction
        .execute(
            "INSERT INTO ai_messages(id, chat_id, turn_id, item_sort, role, content, content_blocks_json,
              provider_id, provider_name, model_id, model_name, status, created_at, updated_at)
             VALUES(?1, ?2, ?3, 0, 'user', ?4, ?5, ?6, ?7, ?8, ?9, 'done', ?10, ?10)",
            params![
                uuid::Uuid::new_v4().to_string(),
                chat_id,
                turn_id,
                user_content,
                content_blocks.to_string(),
                provider_id,
                provider.name,
                model.id,
                model.display_name,
                now
            ],
        )
        .map_err(sql_error)?;
    let assistant_message_id = uuid::Uuid::new_v4().to_string();
    transaction
        .execute(
            "INSERT INTO ai_messages(id, chat_id, turn_id, item_sort, role, content, content_blocks_json,
              provider_id, provider_name, model_id, model_name, status, created_at, updated_at)
             VALUES(?1, ?2, ?3, 1, 'assistant', '', '[]', ?4, ?5, ?6, ?7, 'running', ?8, ?8)",
            params![
                assistant_message_id,
                chat_id,
                turn_id,
                provider_id,
                provider.name,
                model.id,
                model.display_name,
                now
            ],
        )
        .map_err(sql_error)?;
    let title: String = transaction
        .query_row(
            "SELECT title FROM ai_chats WHERE id = ?1",
            [chat_id],
            |row| row.get(0),
        )
        .map_err(sql_error)?;
    let next_title = if title == "新的聊天" {
        chat_title_from_content(user_content)
    } else {
        title
    };
    transaction
        .execute(
            "UPDATE ai_chats SET title = ?2, provider_id = ?3, model_id = ?4, updated_at = ?5 WHERE id = ?1",
            params![chat_id, next_title, provider_id, model.id, now],
        )
        .map_err(sql_error)?;
    transaction.commit().map_err(sql_error)?;
    Ok(assistant_message_id)
}

pub(crate) fn load_turn_replay(
    connection: &Connection,
    chat_id: &str,
    turn_id: &str,
) -> Result<TurnReplay, String> {
    connection
        .query_row(
            "SELECT u.content, u.content_blocks_json,
                    COALESCE(a.provider_id, u.provider_id), COALESCE(a.model_id, u.model_id)
             FROM ai_messages u
             LEFT JOIN ai_messages a ON a.chat_id = u.chat_id AND a.turn_id = u.turn_id AND a.role = 'assistant'
             WHERE u.chat_id = ?1 AND u.turn_id = ?2 AND u.role = 'user'
             ORDER BY a.item_sort DESC LIMIT 1",
            params![chat_id, turn_id],
            |row| {
                let blocks: String = row.get(1)?;
                Ok(TurnReplay {
                    user_content: row.get(0)?,
                    content_blocks: serde_json::from_str(&blocks).unwrap_or_else(|_| json!([])),
                    provider_id: row.get(2)?,
                    model_id: row.get(3)?,
                })
            },
        )
        .map_err(|_| "要重新发送的普通聊天消息不存在或模型快照不完整".to_string())
}

pub(crate) fn delete_chat_turn(
    connection: &Connection,
    chat_id: &str,
    turn_id: &str,
) -> Result<AiChatDetail, String> {
    let transaction = connection.unchecked_transaction().map_err(sql_error)?;
    transaction
        .execute(
            "DELETE FROM ai_tool_calls WHERE chat_id = ?1 AND turn_id = ?2",
            params![chat_id, turn_id],
        )
        .map_err(sql_error)?;
    let deleted = transaction
        .execute(
            "DELETE FROM ai_messages WHERE chat_id = ?1 AND turn_id = ?2",
            params![chat_id, turn_id],
        )
        .map_err(sql_error)?;
    if deleted == 0 {
        return Err("普通聊天消息不存在".to_string());
    }
    transaction
        .execute(
            "UPDATE ai_chats SET updated_at = ?2 WHERE id = ?1",
            params![chat_id, Utc::now().to_rfc3339()],
        )
        .map_err(sql_error)?;
    transaction.commit().map_err(sql_error)?;
    get_chat(connection, chat_id)
}

pub(crate) fn finish_chat_turn(
    connection: &Connection,
    assistant_message_id: &str,
    content: &str,
    reasoning_content: &str,
    status: &str,
    error_message: Option<&str>,
    usage: Option<&Value>,
    citations: Option<&Value>,
) -> Result<(), String> {
    connection
        .execute(
            "UPDATE ai_messages
             SET content = ?2, reasoning_content = ?3, status = ?4, usage_json = ?5,
                 citations_json = ?6, error_message = ?7, updated_at = ?8
             WHERE id = ?1",
            params![
                assistant_message_id,
                content,
                reasoning_content,
                status,
                usage.map(Value::to_string),
                citations
                    .map(Value::to_string)
                    .unwrap_or_else(|| "[]".to_string()),
                error_message,
                Utc::now().to_rfc3339()
            ],
        )
        .map_err(sql_error)?;
    Ok(())
}

pub(crate) fn begin_tool_call(
    connection: &Connection,
    chat_id: &str,
    turn_id: &str,
    tool_call: &ProviderToolCall,
    server_id: Option<&str>,
    risk: &str,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    connection
        .execute(
            "INSERT INTO ai_tool_calls(id, chat_id, turn_id, tool_call_id, server_id, name,
              input_json, status, risk, created_at, updated_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, 'running', ?8, ?9, ?9)
             ON CONFLICT(chat_id, tool_call_id) DO UPDATE SET
              server_id = excluded.server_id, name = excluded.name, input_json = excluded.input_json,
              status = 'running', risk = excluded.risk, approval_json = NULL, result_json = NULL,
              updated_at = excluded.updated_at",
            params![
                uuid::Uuid::new_v4().to_string(),
                chat_id,
                turn_id,
                tool_call.id,
                server_id,
                tool_call.name,
                tool_call.arguments.to_string(),
                risk,
                now
            ],
        )
        .map_err(sql_error)?;
    Ok(())
}

pub(crate) fn mark_tool_call_waiting_approval(
    connection: &Connection,
    chat_id: &str,
    tool_call_id: &str,
    approval: &Value,
) -> Result<(), String> {
    connection
        .execute(
            "UPDATE ai_tool_calls SET status = 'waiting_approval', approval_json = ?3, updated_at = ?4
             WHERE chat_id = ?1 AND tool_call_id = ?2",
            params![
                chat_id,
                tool_call_id,
                approval.to_string(),
                Utc::now().to_rfc3339()
            ],
        )
        .map_err(sql_error)?;
    Ok(())
}

pub(crate) fn finish_tool_call(
    connection: &Connection,
    chat_id: &str,
    tool_call_id: &str,
    status: &str,
    result: &Value,
    approval: Option<&Value>,
) -> Result<(), String> {
    connection
        .execute(
            "UPDATE ai_tool_calls SET status = ?3, result_json = ?4,
              approval_json = COALESCE(?5, approval_json), updated_at = ?6
             WHERE chat_id = ?1 AND tool_call_id = ?2",
            params![
                chat_id,
                tool_call_id,
                status,
                result.to_string(),
                approval.map(Value::to_string),
                Utc::now().to_rfc3339()
            ],
        )
        .map_err(sql_error)?;
    Ok(())
}

pub(crate) fn list_tool_calls(
    connection: &Connection,
    chat_id: &str,
) -> Result<Vec<AiToolCallRecord>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, chat_id, turn_id, tool_call_id, server_id, name, input_json,
                    result_json, status, risk, approval_json, created_at, updated_at
             FROM ai_tool_calls WHERE chat_id = ?1 ORDER BY created_at ASC, rowid ASC",
        )
        .map_err(sql_error)?;
    let rows = statement
        .query_map([chat_id], |row| {
            let input: String = row.get(6)?;
            let result: Option<String> = row.get(7)?;
            let approval: Option<String> = row.get(10)?;
            Ok(AiToolCallRecord {
                id: row.get(0)?,
                chat_id: row.get(1)?,
                turn_id: row.get(2)?,
                tool_call_id: row.get(3)?,
                server_id: row.get(4)?,
                name: row.get(5)?,
                input: serde_json::from_str(&input).unwrap_or_else(|_| json!({})),
                result: result.and_then(|value| serde_json::from_str(&value).ok()),
                status: row.get(8)?,
                risk: row.get(9)?,
                approval: approval.and_then(|value| serde_json::from_str(&value).ok()),
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        })
        .map_err(sql_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sql_error)
}

fn tool_result_text(result: Option<&Value>) -> String {
    let Some(result) = result else {
        return String::new();
    };
    result
        .get("content")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| result.to_string())
}

fn chat_title_from_content(content: &str) -> String {
    let compact = content.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        return "新的聊天".to_string();
    }
    compact.chars().take(36).collect()
}

pub(crate) fn get_chat(connection: &Connection, chat_id: &str) -> Result<AiChatDetail, String> {
    let summary = list_chats(connection)?
        .into_iter()
        .find(|chat| chat.id == chat_id)
        .ok_or_else(|| "普通聊天不存在".to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT id, chat_id, turn_id, item_sort, role, content, reasoning_content, content_blocks_json,
                    provider_id, provider_name, model_id, model_name, status, error_message, usage_json,
                    citations_json, created_at, updated_at
             FROM ai_messages WHERE chat_id = ?1 ORDER BY created_at ASC, item_sort ASC",
        )
        .map_err(sql_error)?;
    let rows = statement
        .query_map([chat_id], |row| {
            let content_blocks: String = row.get(7)?;
            let usage: Option<String> = row.get(14)?;
            let citations: String = row.get(15)?;
            Ok(AiChatMessage {
                id: row.get(0)?,
                chat_id: row.get(1)?,
                turn_id: row.get(2)?,
                item_sort: row.get(3)?,
                role: row.get(4)?,
                content: row.get(5)?,
                reasoning_content: row.get(6)?,
                content_blocks: serde_json::from_str(&content_blocks).unwrap_or_else(|_| json!([])),
                provider_id: row.get(8)?,
                provider_name: row.get(9)?,
                model_id: row.get(10)?,
                model_name: row.get(11)?,
                status: row.get(12)?,
                error_message: row.get(13)?,
                usage: usage.and_then(|value| serde_json::from_str(&value).ok()),
                citations: serde_json::from_str(&citations).unwrap_or_else(|_| json!([])),
                created_at: row.get(16)?,
                updated_at: row.get(17)?,
            })
        })
        .map_err(sql_error)?;
    Ok(AiChatDetail {
        summary,
        messages: rows.collect::<Result<Vec<_>, _>>().map_err(sql_error)?,
        tool_calls: list_tool_calls(connection, chat_id)?,
    })
}

pub(crate) fn create_chat(
    connection: &Connection,
    title: &str,
    provider_id: Option<&str>,
    model_id: Option<&str>,
) -> Result<AiChatDetail, String> {
    validate_chat_model_selection(connection, provider_id, model_id)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    connection
        .execute(
            "INSERT INTO ai_chats(id, title, custom_title, provider_id, model_id, created_at, updated_at)
             VALUES(?1, ?2, 0, ?3, ?4, ?5, ?5)",
            params![id, title, provider_id, model_id, now],
        )
        .map_err(|error| format!("创建普通聊天失败: {error}"))?;
    get_chat(connection, &id)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn update_chat(
    connection: &Connection,
    chat_id: &str,
    title: Option<&str>,
    provider_id: Option<&str>,
    model_id: Option<&str>,
    selected_mcp_ids: Option<&[String]>,
    selected_skill_ids: Option<&[String]>,
    selected_knowledge_ids: Option<&[String]>,
    model_preferences: Option<&BTreeMap<String, AiChatModelPreference>>,
) -> Result<AiChatDetail, String> {
    let current = get_chat(connection, chat_id)?;
    let next_provider = provider_id.or(current.summary.provider_id.as_deref());
    let next_model = model_id.or(current.summary.model_id.as_deref());
    validate_chat_model_selection(connection, next_provider, next_model)?;
    let next_title = title.unwrap_or(&current.summary.title);
    let mcp_json =
        serde_json::to_string(selected_mcp_ids.unwrap_or(&current.summary.selected_mcp_ids))
            .map_err(|error| format!("序列化 MCP 选择失败: {error}"))?;
    let skills_json =
        serde_json::to_string(selected_skill_ids.unwrap_or(&current.summary.selected_skill_ids))
            .map_err(|error| format!("序列化 Skills 选择失败: {error}"))?;
    let knowledge_json = serde_json::to_string(
        selected_knowledge_ids.unwrap_or(&current.summary.selected_knowledge_ids),
    )
    .map_err(|error| format!("序列化知识库选择失败: {error}"))?;
    let model_preferences = model_preferences.unwrap_or(&current.summary.model_preferences);
    validate_model_preferences(model_preferences)?;
    let model_preferences_json = serde_json::to_string(model_preferences)
        .map_err(|error| format!("序列化普通聊天模型偏好失败: {error}"))?;
    connection
        .execute(
            "UPDATE ai_chats SET title = ?2, custom_title = CASE WHEN ?3 IS NULL THEN custom_title ELSE 1 END,
                    provider_id = ?4, model_id = ?5, selected_mcp_json = ?6,
                    selected_skills_json = ?7, selected_knowledge_json = ?8,
                    model_preferences_json = ?9, updated_at = ?10
             WHERE id = ?1",
            params![
                chat_id,
                next_title,
                title,
                next_provider,
                next_model,
                mcp_json,
                skills_json,
                knowledge_json,
                model_preferences_json,
                Utc::now().to_rfc3339()
            ],
        )
        .map_err(|error| format!("更新普通聊天失败: {error}"))?;
    get_chat(connection, chat_id)
}

pub(crate) fn set_chat_pinned(
    connection: &Connection,
    chat_id: &str,
    pinned: bool,
) -> Result<AiChatDetail, String> {
    let changed = connection
        .execute(
            "UPDATE ai_chats SET pinned_at = ?2, updated_at = ?3 WHERE id = ?1",
            params![
                chat_id,
                pinned.then(|| Utc::now().to_rfc3339()),
                Utc::now().to_rfc3339()
            ],
        )
        .map_err(sql_error)?;
    if changed == 0 {
        return Err("普通聊天不存在".to_string());
    }
    get_chat(connection, chat_id)
}

pub(crate) fn delete_chat(connection: &Connection, chat_id: &str) -> Result<bool, String> {
    connection
        .execute("DELETE FROM ai_chats WHERE id = ?1", [chat_id])
        .map(|changed| changed > 0)
        .map_err(sql_error)
}

pub(crate) fn clear_chat(connection: &Connection, chat_id: &str) -> Result<AiChatDetail, String> {
    get_chat(connection, chat_id)?;
    let transaction = connection.unchecked_transaction().map_err(sql_error)?;
    transaction
        .execute("DELETE FROM ai_tool_calls WHERE chat_id = ?1", [chat_id])
        .map_err(sql_error)?;
    transaction
        .execute("DELETE FROM ai_messages WHERE chat_id = ?1", [chat_id])
        .map_err(sql_error)?;
    transaction
        .execute(
            "UPDATE ai_chats SET updated_at = ?2 WHERE id = ?1",
            params![chat_id, Utc::now().to_rfc3339()],
        )
        .map_err(sql_error)?;
    transaction.commit().map_err(sql_error)?;
    get_chat(connection, chat_id)
}

fn validate_chat_model_selection(
    connection: &Connection,
    provider_id: Option<&str>,
    model_id: Option<&str>,
) -> Result<(), String> {
    match (provider_id, model_id) {
        (None, None) => Ok(()),
        (Some(provider_id), None) => get_stored_provider(connection, provider_id).map(|_| ()),
        (None, Some(_)) => Err("选择模型前必须先选择供应商".to_string()),
        (Some(provider_id), Some(model_id)) => {
            let exists: bool = connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM ai_models WHERE id = ?1 AND provider_id = ?2 AND enabled = 1)",
                    params![model_id, provider_id],
                    |row| row.get(0),
                )
                .map_err(sql_error)?;
            if exists {
                Ok(())
            } else {
                Err("所选模型不属于当前供应商或尚未启用".to_string())
            }
        }
    }
}

fn chat_summary_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AiChatSummary> {
    let mcp_json: String = row.get(4)?;
    let skills_json: String = row.get(5)?;
    let knowledge_json: String = row.get(6)?;
    let model_preferences_json: String = row.get(7)?;
    Ok(AiChatSummary {
        id: row.get(0)?,
        title: row.get(1)?,
        provider_id: row.get(2)?,
        model_id: row.get(3)?,
        selected_mcp_ids: serde_json::from_str(&mcp_json).unwrap_or_default(),
        selected_skill_ids: serde_json::from_str(&skills_json).unwrap_or_default(),
        selected_knowledge_ids: serde_json::from_str(&knowledge_json).unwrap_or_default(),
        model_preferences: serde_json::from_str(&model_preferences_json).unwrap_or_default(),
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        pinned_at: row.get(10)?,
        message_count: row.get::<_, i64>(11)?.max(0) as usize,
        last_message_preview: row.get(12)?,
    })
}

fn validate_model_preferences(
    preferences: &BTreeMap<String, AiChatModelPreference>,
) -> Result<(), String> {
    if preferences.len() > 100 {
        return Err("普通聊天模型偏好数量过多".to_string());
    }
    for (model_id, preference) in preferences {
        if model_id.trim().is_empty() {
            return Err("普通聊天模型偏好缺少 modelId".to_string());
        }
        if !matches!(
            preference.reasoning_effort.as_str(),
            "low" | "medium" | "high" | "xhigh"
        ) {
            return Err("普通聊天思考等级无效".to_string());
        }
    }
    Ok(())
}

fn sql_error(error: rusqlite::Error) -> String {
    format!("普通聊天数据库操作失败: {error}")
}

#[cfg(test)]
mod tests {
    use super::{
        begin_chat_turn, begin_tool_call, clear_chat, create_chat, delete_model, finish_chat_turn,
        finish_tool_call, get_chat, get_stored_model, get_stored_provider, initialize_database,
        list_chats, list_model_messages, list_models, repair_provider_defaults, set_chat_pinned,
        set_default_provider, update_chat, upsert_model,
    };
    use crate::ordinary_chat::types::ProviderToolCall;
    use rusqlite::Connection;
    use serde_json::json;

    #[test]
    fn schema_allows_multiple_provider_instances_with_same_preset() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();
        connection.execute(
            "INSERT INTO ai_providers(id, preset_id, name, protocol, base_url, enabled, secret_slot, created_at, updated_at)
             VALUES
               ('p1', 'deepseek', 'DeepSeek', 'openai_chat', 'https://api.deepseek.com', 1, 'slot-1', 'now', 'now'),
               ('p2', 'deepseek', 'DeepSeek 2', 'openai_chat', 'https://api.deepseek.com', 1, 'slot-2', 'now', 'now')",
            [],
        ).unwrap();

        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM ai_providers WHERE preset_id = 'deepseek'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn legacy_provider_schema_adds_and_repairs_single_default() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(
            "CREATE TABLE ai_providers (
               id TEXT PRIMARY KEY,
               preset_id TEXT,
               name TEXT NOT NULL,
               protocol TEXT NOT NULL,
               base_url TEXT NOT NULL,
               enabled INTEGER NOT NULL DEFAULT 1,
               secret_slot TEXT NOT NULL UNIQUE,
               created_at TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             INSERT INTO ai_providers(id, name, protocol, base_url, enabled, secret_slot, created_at, updated_at)
             VALUES
               ('p1', 'Provider 1', 'openai_chat', 'https://example.com/v1', 1, 'slot-1', '2026-01-01', '2026-01-01'),
               ('p2', 'Provider 2', 'openai_chat', 'https://example.com/v1', 1, 'slot-2', '2026-01-02', '2026-01-02');",
        ).unwrap();

        initialize_database(&connection).unwrap();

        let default_id: String = connection
            .query_row(
                "SELECT id FROM ai_providers WHERE is_default = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(default_id, "p1");
    }

    #[test]
    fn legacy_message_schema_adds_error_detail_without_losing_history() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(
            "CREATE TABLE ai_messages (
               id TEXT PRIMARY KEY,
               chat_id TEXT NOT NULL,
               turn_id TEXT NOT NULL,
               item_sort INTEGER NOT NULL,
               role TEXT NOT NULL,
               content TEXT NOT NULL,
               reasoning_content TEXT NOT NULL DEFAULT '',
               content_blocks_json TEXT NOT NULL DEFAULT '[]',
               provider_id TEXT,
               provider_name TEXT,
               model_id TEXT,
               model_name TEXT,
               status TEXT NOT NULL,
               usage_json TEXT,
               citations_json TEXT NOT NULL DEFAULT '[]',
               created_at TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             INSERT INTO ai_messages(
               id, chat_id, turn_id, item_sort, role, content, status, created_at, updated_at
             ) VALUES('message-1', 'chat-1', 'turn-1', 1, 'assistant', '旧回复', 'done', 'now', 'now');",
        )
        .unwrap();

        initialize_database(&connection).unwrap();

        let (content, error_message): (String, Option<String>) = connection
            .query_row(
                "SELECT content, error_message FROM ai_messages WHERE id = 'message-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(content, "旧回复");
        assert_eq!(error_message, None);
    }

    #[test]
    fn provider_default_switches_and_repairs_after_disable() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();
        connection.execute_batch(
            "INSERT INTO ai_providers(id, name, protocol, base_url, enabled, secret_slot, created_at, updated_at)
             VALUES
               ('p1', 'Provider 1', 'openai_chat', 'https://example.com/v1', 1, 'slot-1', '2026-01-01', '2026-01-01'),
               ('p2', 'Provider 2', 'openai_chat', 'https://example.com/v1', 1, 'slot-2', '2026-01-02', '2026-01-02');",
        ).unwrap();
        repair_provider_defaults(&connection).unwrap();
        set_default_provider(&connection, "p2").unwrap();
        let default_id: String = connection
            .query_row(
                "SELECT id FROM ai_providers WHERE is_default = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(default_id, "p2");

        connection
            .execute("UPDATE ai_providers SET enabled = 0 WHERE id = 'p2'", [])
            .unwrap();
        repair_provider_defaults(&connection).unwrap();
        let default_id: String = connection
            .query_row(
                "SELECT id FROM ai_providers WHERE is_default = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(default_id, "p1");

        connection
            .execute("UPDATE ai_providers SET enabled = 0 WHERE id = 'p1'", [])
            .unwrap();
        repair_provider_defaults(&connection).unwrap();
        let default_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM ai_providers WHERE is_default = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(default_count, 0);
    }

    #[test]
    fn schema_supports_multiple_models_and_single_default() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();
        connection.execute(
            "INSERT INTO ai_providers(id, name, protocol, base_url, enabled, secret_slot, created_at, updated_at)
             VALUES('p1', 'Provider', 'openai_chat', 'https://example.com/v1', 1, 'slot', 'now', 'now')",
            [],
        ).unwrap();
        upsert_model(&connection, "p1", "m1", "Model 1", true, true, &json!({})).unwrap();
        upsert_model(&connection, "p1", "m2", "Model 2", true, true, &json!({})).unwrap();
        let models = list_models(&connection, "p1").unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!(models.iter().filter(|model| model.is_default).count(), 1);
        assert_eq!(
            models
                .iter()
                .find(|model| model.is_default)
                .unwrap()
                .model_id,
            "m2"
        );
    }

    #[test]
    fn model_mutations_preserve_enabled_default_invariant() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();
        connection.execute(
            "INSERT INTO ai_providers(id, name, protocol, base_url, enabled, secret_slot, created_at, updated_at)
             VALUES('p1', 'Provider', 'openai_chat', 'https://example.com/v1', 1, 'slot', 'now', 'now')",
            [],
        ).unwrap();

        upsert_model(&connection, "p1", "m1", "Model 1", true, false, &json!({})).unwrap();
        upsert_model(&connection, "p1", "m2", "Model 2", true, false, &json!({})).unwrap();
        let models = list_models(&connection, "p1").unwrap();
        assert_eq!(models.iter().filter(|model| model.is_default).count(), 1);
        assert_eq!(
            models
                .iter()
                .find(|model| model.is_default)
                .unwrap()
                .model_id,
            "m1"
        );

        upsert_model(&connection, "p1", "m1", "Model 1", false, false, &json!({})).unwrap();
        let models = list_models(&connection, "p1").unwrap();
        let promoted = models.iter().find(|model| model.is_default).unwrap();
        assert_eq!(promoted.model_id, "m2");
        assert!(promoted.enabled);
        assert!(
            !models
                .iter()
                .find(|model| model.model_id == "m1")
                .unwrap()
                .is_default
        );

        let promoted_id = promoted.id.clone();
        assert!(delete_model(&connection, &promoted_id).unwrap());
        let models = list_models(&connection, "p1").unwrap();
        assert_eq!(models.iter().filter(|model| model.is_default).count(), 0);

        upsert_model(&connection, "p1", "m1", "Model 1", false, true, &json!({})).unwrap();
        let models = list_models(&connection, "p1").unwrap();
        let default_model = models.iter().find(|model| model.is_default).unwrap();
        assert_eq!(default_model.model_id, "m1");
        assert!(default_model.enabled);
    }

    #[test]
    fn initialization_repairs_legacy_default_state() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();
        connection.execute(
            "INSERT INTO ai_providers(id, name, protocol, base_url, enabled, secret_slot, created_at, updated_at)
             VALUES('p1', 'Provider', 'openai_chat', 'https://example.com/v1', 1, 'slot', 'now', 'now')",
            [],
        ).unwrap();
        connection.execute(
            "INSERT INTO ai_models(id, provider_id, model_id, display_name, enabled, is_default, capabilities_json, created_at, updated_at)
             VALUES
               ('m1-row', 'p1', 'm1', 'Model 1', 1, 0, '{}', '2026-01-01', 'now'),
               ('m2-row', 'p1', 'm2', 'Model 2', 0, 1, '{}', '2026-01-02', 'now')",
            [],
        ).unwrap();

        initialize_database(&connection).unwrap();
        let models = list_models(&connection, "p1").unwrap();
        let default_model = models.iter().find(|model| model.is_default).unwrap();
        assert_eq!(default_model.model_id, "m1");
        assert!(default_model.enabled);
        assert!(
            !models
                .iter()
                .find(|model| model.model_id == "m2")
                .unwrap()
                .is_default
        );
    }

    #[test]
    fn chat_selection_is_independent_from_agent_threads() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();
        connection
            .execute(
                "INSERT INTO ai_providers(id, name, protocol, base_url, enabled, secret_slot, created_at, updated_at)
                 VALUES('p1', 'Provider', 'openai_chat', 'https://example.com/v1', 1, 'slot', 'now', 'now')",
                [],
            )
            .unwrap();
        upsert_model(
            &connection,
            "p1",
            "api-model",
            "Model",
            true,
            true,
            &json!({}),
        )
        .unwrap();
        let model_id: String = connection
            .query_row("SELECT id FROM ai_models LIMIT 1", [], |row| row.get(0))
            .unwrap();
        let chat = create_chat(&connection, "新的聊天", Some("p1"), Some(&model_id)).unwrap();
        let updated = update_chat(
            &connection,
            &chat.summary.id,
            Some("已重命名"),
            Some("p1"),
            Some(&model_id),
            Some(&["mcp-1".to_string()]),
            Some(&["skill-1".to_string()]),
            Some(&["kb-1".to_string()]),
            None,
        )
        .unwrap();
        assert_eq!(updated.summary.title, "已重命名");
        assert_eq!(updated.summary.selected_mcp_ids, vec!["mcp-1"]);
        assert!(set_chat_pinned(&connection, &chat.summary.id, true)
            .unwrap()
            .summary
            .pinned_at
            .is_some());
        assert_eq!(list_chats(&connection).unwrap().len(), 1);
        assert!(clear_chat(&connection, &chat.summary.id)
            .unwrap()
            .messages
            .is_empty());
        assert_eq!(
            get_chat(&connection, &chat.summary.id)
                .unwrap()
                .summary
                .model_id
                .as_deref(),
            Some(model_id.as_str())
        );
    }

    #[test]
    fn tool_calls_persist_and_rebuild_model_history() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();
        connection.execute(
            "INSERT INTO ai_providers(id, name, protocol, base_url, enabled, secret_slot, created_at, updated_at)
             VALUES('p1', 'Provider', 'openai_chat', 'https://example.com/v1', 1, 'slot', 'now', 'now')",
            [],
        ).unwrap();
        upsert_model(
            &connection,
            "p1",
            "api-model",
            "Model",
            true,
            true,
            &json!({}),
        )
        .unwrap();
        let model_id: String = connection
            .query_row("SELECT id FROM ai_models LIMIT 1", [], |row| row.get(0))
            .unwrap();
        let chat = create_chat(&connection, "新的聊天", Some("p1"), Some(&model_id)).unwrap();
        let provider = get_stored_provider(&connection, "p1").unwrap();
        let model = get_stored_model(&connection, "p1", &model_id).unwrap();
        let assistant_id = begin_chat_turn(
            &connection,
            &chat.summary.id,
            "turn-1",
            "读取文件",
            &json!([{ "type": "text", "text": "读取文件" }]),
            &provider,
            "p1",
            &model,
            None,
        )
        .unwrap();
        let call = ProviderToolCall {
            id: "call-1".to_string(),
            name: "mcp__files__read".to_string(),
            arguments: json!({ "path": "README.md" }),
        };
        begin_tool_call(
            &connection,
            &chat.summary.id,
            "turn-1",
            &call,
            Some("server-1"),
            "safe",
        )
        .unwrap();
        finish_tool_call(
            &connection,
            &chat.summary.id,
            "call-1",
            "done",
            &json!({ "content": "文件内容", "isError": false }),
            None,
        )
        .unwrap();
        finish_chat_turn(
            &connection,
            &assistant_id,
            "读取完成",
            "先读取文件，再总结内容。",
            "done",
            None,
            None,
            None,
        )
        .unwrap();

        let detail = get_chat(&connection, &chat.summary.id).unwrap();
        assert_eq!(detail.tool_calls.len(), 1);
        assert_eq!(
            detail
                .messages
                .iter()
                .find(|message| message.role == "assistant")
                .map(|message| message.reasoning_content.as_str()),
            Some("先读取文件，再总结内容。")
        );
        let history = list_model_messages(&connection, &chat.summary.id).unwrap();
        assert!(history.iter().any(|message| !message.tool_calls.is_empty()));
        assert!(history.iter().any(|message| {
            message.role == "tool" && message.tool_call_id.as_deref() == Some("call-1")
        }));
    }

    #[test]
    fn failed_chat_turn_persists_and_clears_error_detail() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();
        connection.execute(
            "INSERT INTO ai_providers(id, name, protocol, base_url, enabled, secret_slot, created_at, updated_at)
             VALUES('p1', 'Provider', 'openai_chat', 'https://example.com/v1', 1, 'slot', 'now', 'now')",
            [],
        ).unwrap();
        upsert_model(
            &connection,
            "p1",
            "api-model",
            "Model",
            true,
            true,
            &json!({}),
        )
        .unwrap();
        let model_id: String = connection
            .query_row("SELECT id FROM ai_models LIMIT 1", [], |row| row.get(0))
            .unwrap();
        let chat = create_chat(&connection, "新的聊天", Some("p1"), Some(&model_id)).unwrap();
        let provider = get_stored_provider(&connection, "p1").unwrap();
        let model = get_stored_model(&connection, "p1", &model_id).unwrap();
        let assistant_id = begin_chat_turn(
            &connection,
            &chat.summary.id,
            "turn-1",
            "你好",
            &json!([{ "type": "text", "text": "你好" }]),
            &provider,
            "p1",
            &model,
            None,
        )
        .unwrap();

        finish_chat_turn(
            &connection,
            &assistant_id,
            "",
            "",
            "error",
            Some("Provider 请求失败（HTTP 400）：thinking 参数不受支持"),
            None,
            None,
        )
        .unwrap();
        let detail = get_chat(&connection, &chat.summary.id).unwrap();
        let assistant = detail
            .messages
            .iter()
            .find(|message| message.role == "assistant")
            .unwrap();
        assert_eq!(
            assistant.error_message.as_deref(),
            Some("Provider 请求失败（HTTP 400）：thinking 参数不受支持")
        );

        finish_chat_turn(
            &connection,
            &assistant_id,
            "恢复后的回复",
            "",
            "done",
            None,
            None,
            None,
        )
        .unwrap();
        let detail = get_chat(&connection, &chat.summary.id).unwrap();
        let assistant = detail
            .messages
            .iter()
            .find(|message| message.role == "assistant")
            .unwrap();
        assert_eq!(assistant.error_message, None);
    }

    #[test]
    fn editing_a_turn_truncates_following_history_atomically() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();
        connection.execute(
            "INSERT INTO ai_providers(id, name, protocol, base_url, enabled, secret_slot, created_at, updated_at)
             VALUES('p1', 'Provider', 'openai_chat', 'https://example.com/v1', 1, 'slot', 'now', 'now')",
            [],
        ).unwrap();
        upsert_model(
            &connection,
            "p1",
            "api-model",
            "Model",
            true,
            true,
            &json!({}),
        )
        .unwrap();
        let model_id: String = connection
            .query_row("SELECT id FROM ai_models LIMIT 1", [], |row| row.get(0))
            .unwrap();
        let chat = create_chat(&connection, "新的聊天", Some("p1"), Some(&model_id)).unwrap();
        let provider = get_stored_provider(&connection, "p1").unwrap();
        let model = get_stored_model(&connection, "p1", &model_id).unwrap();
        for (turn_id, content) in [("turn-1", "第一条"), ("turn-2", "第二条")] {
            let assistant_id = begin_chat_turn(
                &connection,
                &chat.summary.id,
                turn_id,
                content,
                &json!([{ "type": "text", "text": content }]),
                &provider,
                "p1",
                &model,
                None,
            )
            .unwrap();
            finish_chat_turn(
                &connection,
                &assistant_id,
                "回复",
                "",
                "done",
                None,
                None,
                None,
            )
            .unwrap();
        }
        let replacement_id = begin_chat_turn(
            &connection,
            &chat.summary.id,
            "turn-1",
            "编辑后的第一条",
            &json!([{ "type": "text", "text": "编辑后的第一条" }]),
            &provider,
            "p1",
            &model,
            Some("turn-1"),
        )
        .unwrap();
        finish_chat_turn(
            &connection,
            &replacement_id,
            "新回复",
            "",
            "done",
            None,
            None,
            None,
        )
        .unwrap();
        let detail = get_chat(&connection, &chat.summary.id).unwrap();
        assert_eq!(detail.messages.len(), 2);
        assert!(detail
            .messages
            .iter()
            .all(|message| message.turn_id == "turn-1"));
        assert_eq!(detail.messages[0].content, "编辑后的第一条");
    }
}
