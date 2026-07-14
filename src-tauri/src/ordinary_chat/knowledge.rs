use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    cmp::Ordering,
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};
use uuid::Uuid;

const DEFAULT_CHUNK_SIZE: usize = 1200;
const DEFAULT_CHUNK_OVERLAP: usize = 180;
const EMBEDDING_DIMENSIONS: usize = 256;
const MAX_SOURCE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_DIRECTORY_BYTES: u64 = 50 * 1024 * 1024;
const MAX_DIRECTORY_FILES: usize = 500;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateKnowledgeBaseRequest {
    pub name: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateKnowledgeBaseRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub chunk_size: Option<usize>,
    pub chunk_overlap: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportKnowledgeSourceRequest {
    pub path: Option<String>,
    pub text: Option<String>,
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchKnowledgeRequest {
    pub query: String,
    #[serde(default)]
    pub knowledge_base_ids: Vec<String>,
    pub limit: Option<usize>,
}

pub(crate) fn list_knowledge_bases(connection: &Connection) -> Result<Vec<Value>, String> {
    let mut statement = connection
        .prepare(
            "SELECT k.id, k.name, k.description, k.chunk_size, k.chunk_overlap,
                    k.created_at, k.updated_at,
                    COUNT(DISTINCT s.id), COUNT(DISTINCT c.id)
             FROM ai_knowledge_bases k
             LEFT JOIN ai_knowledge_sources s ON s.knowledge_base_id = k.id
             LEFT JOIN ai_knowledge_chunks c ON c.knowledge_base_id = k.id
             GROUP BY k.id
             ORDER BY k.updated_at DESC, k.name COLLATE NOCASE ASC",
        )
        .map_err(database_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "description": row.get::<_, String>(2)?,
                "embeddingMode": "local-hash",
                "chunkSize": row.get::<_, i64>(3)?.max(200) as usize,
                "chunkOverlap": row.get::<_, i64>(4)?.max(0) as usize,
                "createdAt": row.get::<_, String>(5)?,
                "updatedAt": row.get::<_, String>(6)?,
                "sourceCount": row.get::<_, i64>(7)?.max(0) as usize,
                "chunkCount": row.get::<_, i64>(8)?.max(0) as usize,
            }))
        })
        .map_err(database_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(database_error)
}

pub(crate) fn get_knowledge_base(connection: &Connection, id: &str) -> Result<Value, String> {
    let base = list_knowledge_bases(connection)?
        .into_iter()
        .find(|item| item.get("id").and_then(Value::as_str) == Some(id))
        .ok_or_else(|| "知识库不存在".to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT id, kind, name, source_path, content_hash, status, error_message,
                    chunk_count, created_at, updated_at
             FROM ai_knowledge_sources
             WHERE knowledge_base_id = ?1
             ORDER BY updated_at DESC, name COLLATE NOCASE ASC",
        )
        .map_err(database_error)?;
    let sources = statement
        .query_map(params![id], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "knowledgeBaseId": id,
                "kind": row.get::<_, String>(1)?,
                "name": row.get::<_, String>(2)?,
                "sourcePath": row.get::<_, Option<String>>(3)?,
                "contentHash": row.get::<_, String>(4)?,
                "status": row.get::<_, String>(5)?,
                "errorMessage": row.get::<_, Option<String>>(6)?,
                "chunkCount": row.get::<_, i64>(7)?.max(0) as usize,
                "createdAt": row.get::<_, String>(8)?,
                "updatedAt": row.get::<_, String>(9)?,
            }))
        })
        .map_err(database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(database_error)?;
    Ok(json!({ "summary": base, "sources": sources }))
}

pub(crate) fn create_knowledge_base(
    connection: &Connection,
    request: CreateKnowledgeBaseRequest,
) -> Result<Value, String> {
    let name = required_name(&request.name, "知识库名称不能为空")?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    connection
        .execute(
            "INSERT INTO ai_knowledge_bases
             (id, name, description, chunk_size, chunk_overlap, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![
                id,
                name,
                request.description.trim(),
                DEFAULT_CHUNK_SIZE as i64,
                DEFAULT_CHUNK_OVERLAP as i64,
                now
            ],
        )
        .map_err(database_error)?;
    get_knowledge_base(connection, &id)
}

pub(crate) fn update_knowledge_base(
    connection: &Connection,
    id: &str,
    request: UpdateKnowledgeBaseRequest,
) -> Result<Value, String> {
    let should_rebuild = request.chunk_size.is_some() || request.chunk_overlap.is_some();
    let transaction = connection.unchecked_transaction().map_err(database_error)?;
    let current = get_knowledge_base(&transaction, id)?;
    let summary = current.get("summary").cloned().unwrap_or(Value::Null);
    let name = request
        .name
        .as_deref()
        .map(|value| required_name(value, "知识库名称不能为空"))
        .transpose()?
        .unwrap_or_else(|| {
            summary
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("知识库")
                .to_string()
        });
    let description = request.description.unwrap_or_else(|| {
        summary
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    });
    let chunk_size = request
        .chunk_size
        .unwrap_or_else(|| {
            summary
                .get("chunkSize")
                .and_then(Value::as_u64)
                .unwrap_or(DEFAULT_CHUNK_SIZE as u64) as usize
        })
        .clamp(400, 4000);
    let chunk_overlap = request
        .chunk_overlap
        .unwrap_or_else(|| {
            summary
                .get("chunkOverlap")
                .and_then(Value::as_u64)
                .unwrap_or(DEFAULT_CHUNK_OVERLAP as u64) as usize
        })
        .min(chunk_size / 2);
    transaction
        .execute(
            "UPDATE ai_knowledge_bases
             SET name = ?2, description = ?3, chunk_size = ?4, chunk_overlap = ?5, updated_at = ?6
             WHERE id = ?1",
            params![
                id,
                name,
                description.trim(),
                chunk_size as i64,
                chunk_overlap as i64,
                Utc::now().to_rfc3339()
            ],
        )
        .map_err(database_error)?;
    if should_rebuild {
        rebuild_knowledge_base_in_transaction(&transaction, id)?;
    }
    let knowledge_base = get_knowledge_base(&transaction, id)?;
    transaction.commit().map_err(database_error)?;
    Ok(knowledge_base)
}

pub(crate) fn delete_knowledge_base(connection: &Connection, id: &str) -> Result<bool, String> {
    connection
        .execute("DELETE FROM ai_knowledge_bases WHERE id = ?1", params![id])
        .map(|count| count > 0)
        .map_err(database_error)
}

pub(crate) fn delete_knowledge_source(
    connection: &Connection,
    knowledge_base_id: &str,
    source_id: &str,
) -> Result<bool, String> {
    let deleted = connection
        .execute(
            "DELETE FROM ai_knowledge_sources WHERE id = ?1 AND knowledge_base_id = ?2",
            params![source_id, knowledge_base_id],
        )
        .map_err(database_error)?
        > 0;
    if deleted {
        touch_knowledge_base(connection, knowledge_base_id)?;
    }
    Ok(deleted)
}

pub(crate) fn import_knowledge_sources(
    connection: &mut Connection,
    knowledge_base_id: &str,
    request: ImportKnowledgeSourceRequest,
) -> Result<Vec<Value>, String> {
    ensure_knowledge_base(connection, knowledge_base_id)?;
    let sources = if let Some(text) = request.text.filter(|value| !value.trim().is_empty()) {
        vec![PendingSource {
            kind: "text".to_string(),
            name: request
                .name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("粘贴文本")
                .to_string(),
            path: None,
            content: text,
        }]
    } else if let Some(path) = request
        .path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        collect_path_sources(Path::new(path))?
    } else {
        return Err("请选择文件、目录或提供文本内容".to_string());
    };
    if sources.is_empty() {
        return Err("没有发现可导入的文本文件".to_string());
    }
    let transaction = connection.transaction().map_err(database_error)?;
    let mut imported = Vec::new();
    for source in sources {
        imported.push(upsert_source(&transaction, knowledge_base_id, source)?);
    }
    touch_knowledge_base(&transaction, knowledge_base_id)?;
    transaction.commit().map_err(database_error)?;
    Ok(imported)
}

pub(crate) fn rebuild_knowledge_base(connection: &Connection, id: &str) -> Result<Value, String> {
    let transaction = connection.unchecked_transaction().map_err(database_error)?;
    rebuild_knowledge_base_in_transaction(&transaction, id)?;
    let knowledge_base = get_knowledge_base(&transaction, id)?;
    transaction.commit().map_err(database_error)?;
    Ok(knowledge_base)
}

fn rebuild_knowledge_base_in_transaction(connection: &Connection, id: &str) -> Result<(), String> {
    ensure_knowledge_base(connection, id)?;
    let (chunk_size, chunk_overlap) = knowledge_chunk_settings(connection, id)?;
    let mut statement = connection
        .prepare(
            "SELECT id, name, source_path FROM ai_knowledge_sources
             WHERE knowledge_base_id = ?1 AND source_path IS NOT NULL",
        )
        .map_err(database_error)?;
    let sources = statement
        .query_map(params![id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(database_error)?;
    for (source_id, name, path) in sources {
        let path = PathBuf::from(path);
        if !path.is_file() {
            mark_source_error(connection, &source_id, "源文件不存在")?;
            continue;
        }
        match read_text_file(&path) {
            Ok(content) => replace_source_chunks(
                connection,
                id,
                &source_id,
                &name,
                Some(&path),
                &content,
                chunk_size,
                chunk_overlap,
            )?,
            Err(error) => mark_source_error(connection, &source_id, &error)?,
        }
    }
    touch_knowledge_base(connection, id)?;
    Ok(())
}

pub(crate) fn search_knowledge(
    connection: &Connection,
    knowledge_base_ids: &[String],
    query: &str,
    limit: usize,
) -> Result<Vec<Value>, String> {
    let query = query.trim();
    if query.is_empty() || knowledge_base_ids.is_empty() {
        return Ok(Vec::new());
    }
    let selected = knowledge_base_ids.iter().collect::<HashSet<_>>();
    let query_embedding = local_embedding(query);
    let query_lower = query.to_lowercase();
    let mut statement = connection
        .prepare(
            "SELECT c.knowledge_base_id, c.source_id, s.name, s.source_path,
                    c.chunk_index, c.content, c.embedding_json
             FROM ai_knowledge_chunks c
             JOIN ai_knowledge_sources s ON s.id = c.source_id
             WHERE s.status = 'ready'",
        )
        .map_err(database_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
            ))
        })
        .map_err(database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(database_error)?;
    let mut hits = rows
        .into_iter()
        .filter(|row| selected.contains(&row.0))
        .map(
            |(
                knowledge_base_id,
                source_id,
                source_name,
                source_path,
                chunk_index,
                content,
                embedding_json,
            )| {
                let embedding = embedding_json
                    .as_deref()
                    .and_then(|value| serde_json::from_str::<Vec<f32>>(value).ok())
                    .unwrap_or_else(|| local_embedding(&content));
                let mut score = dot_product(&query_embedding, &embedding);
                if content.to_lowercase().contains(&query_lower) {
                    score += 0.2;
                }
                (
                    score,
                    json!({
                        "knowledgeBaseId": knowledge_base_id,
                        "sourceId": source_id,
                        "sourceName": source_name,
                        "sourcePath": source_path,
                        "chunkIndex": chunk_index,
                        "content": content,
                        "score": score,
                    }),
                )
            },
        )
        .filter(|(score, _)| *score > 0.02)
        .collect::<Vec<_>>();
    hits.sort_by(|left, right| right.0.partial_cmp(&left.0).unwrap_or(Ordering::Equal));
    Ok(hits
        .into_iter()
        .take(limit.clamp(1, 20))
        .map(|(_, value)| value)
        .collect())
}

pub(crate) fn search_request(
    connection: &Connection,
    request: SearchKnowledgeRequest,
) -> Result<Vec<Value>, String> {
    search_knowledge(
        connection,
        &request.knowledge_base_ids,
        &request.query,
        request.limit.unwrap_or(6),
    )
}

struct PendingSource {
    kind: String,
    name: String,
    path: Option<PathBuf>,
    content: String,
}

fn upsert_source(
    connection: &Connection,
    knowledge_base_id: &str,
    source: PendingSource,
) -> Result<Value, String> {
    let path_text = source
        .path
        .as_ref()
        .map(|path| path.to_string_lossy().to_string());
    let existing_id = if let Some(path) = path_text.as_deref() {
        connection
            .query_row(
                "SELECT id FROM ai_knowledge_sources WHERE knowledge_base_id = ?1 AND source_path = ?2",
                params![knowledge_base_id, path],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(database_error)?
    } else {
        None
    };
    let source_id = existing_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let hash = content_hash(&source.content);
    let now = Utc::now().to_rfc3339();
    connection
        .execute(
            "INSERT INTO ai_knowledge_sources
             (id, knowledge_base_id, kind, name, source_path, content_hash, status, error_message, chunk_count, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'indexing', NULL, 0, ?7, ?7)
             ON CONFLICT(id) DO UPDATE SET
               kind = excluded.kind, name = excluded.name, source_path = excluded.source_path,
               content_hash = excluded.content_hash, status = 'indexing', error_message = NULL,
               updated_at = excluded.updated_at",
            params![source_id, knowledge_base_id, source.kind, source.name, path_text, hash, now],
        )
        .map_err(database_error)?;
    let (chunk_size, chunk_overlap) = knowledge_chunk_settings(connection, knowledge_base_id)?;
    replace_source_chunks(
        connection,
        knowledge_base_id,
        &source_id,
        &source.name,
        source.path.as_deref(),
        &source.content,
        chunk_size,
        chunk_overlap,
    )?;
    Ok(json!({
        "id": source_id,
        "knowledgeBaseId": knowledge_base_id,
        "kind": source.kind,
        "name": source.name,
        "sourcePath": path_text,
        "contentHash": hash,
        "status": "ready",
        "chunkCount": split_text(&source.content, chunk_size, chunk_overlap).len(),
        "createdAt": now,
        "updatedAt": now,
    }))
}

fn replace_source_chunks(
    connection: &Connection,
    knowledge_base_id: &str,
    source_id: &str,
    source_name: &str,
    source_path: Option<&Path>,
    content: &str,
    chunk_size: usize,
    chunk_overlap: usize,
) -> Result<(), String> {
    let chunks = split_text(content, chunk_size, chunk_overlap);
    connection
        .execute(
            "DELETE FROM ai_knowledge_chunks WHERE source_id = ?1",
            params![source_id],
        )
        .map_err(database_error)?;
    let now = Utc::now().to_rfc3339();
    for (index, chunk) in chunks.iter().enumerate() {
        let embedding = serde_json::to_string(&local_embedding(chunk))
            .map_err(|error| format!("序列化知识库向量失败: {error}"))?;
        connection
            .execute(
                "INSERT INTO ai_knowledge_chunks
                 (id, knowledge_base_id, source_id, chunk_index, content, token_estimate, embedding_json, metadata_json, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    Uuid::new_v4().to_string(),
                    knowledge_base_id,
                    source_id,
                    index as i64,
                    chunk,
                    chunk.chars().count().div_ceil(4) as i64,
                    embedding,
                    json!({ "sourceName": source_name, "sourcePath": source_path }).to_string(),
                    now
                ],
            )
            .map_err(database_error)?;
    }
    connection
        .execute(
            "UPDATE ai_knowledge_sources
             SET content_hash = ?2, status = 'ready', error_message = NULL,
                 chunk_count = ?3, updated_at = ?4
             WHERE id = ?1",
            params![source_id, content_hash(content), chunks.len() as i64, now],
        )
        .map_err(database_error)?;
    Ok(())
}

fn collect_path_sources(path: &Path) -> Result<Vec<PendingSource>, String> {
    let canonical = fs::canonicalize(path).map_err(|_| "导入路径不存在".to_string())?;
    if canonical.is_file() {
        return Ok(vec![pending_file_source(&canonical)?]);
    }
    if !canonical.is_dir() {
        return Err("导入路径不是文件或目录".to_string());
    }
    let mut files = Vec::new();
    collect_text_files(&canonical, 0, &mut files)?;
    if files.len() > MAX_DIRECTORY_FILES {
        return Err(format!(
            "目录中文本文件超过 {MAX_DIRECTORY_FILES} 个，请拆分导入"
        ));
    }
    let total_bytes = files.iter().try_fold(0u64, |total, file| {
        let size = file
            .metadata()
            .map_err(|error| format!("读取文件信息失败: {error}"))?
            .len();
        let next = total.saturating_add(size);
        if next > MAX_DIRECTORY_BYTES {
            return Err("目录可导入文本总量超过 50 MB".to_string());
        }
        Ok(next)
    })?;
    let _ = total_bytes;
    files
        .into_iter()
        .map(|file| pending_file_source(&file))
        .collect()
}

fn collect_text_files(path: &Path, depth: usize, output: &mut Vec<PathBuf>) -> Result<(), String> {
    if depth > 12 || output.len() > MAX_DIRECTORY_FILES {
        return Ok(());
    }
    let entries = fs::read_dir(path).map_err(|error| format!("读取目录失败: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取目录失败: {error}"))?;
        let child = entry.path();
        let name = child
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if name.starts_with('.') || matches!(name, "node_modules" | "target" | "dist" | "build") {
            continue;
        }
        if child.is_dir() {
            collect_text_files(&child, depth + 1, output)?;
        } else if child.is_file() && is_supported_text_path(&child) {
            output.push(child);
        }
    }
    Ok(())
}

fn pending_file_source(path: &Path) -> Result<PendingSource, String> {
    let content = read_text_file(path)?;
    Ok(PendingSource {
        kind: "file".to_string(),
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("文件")
            .to_string(),
        path: Some(path.to_path_buf()),
        content,
    })
}

fn read_text_file(path: &Path) -> Result<String, String> {
    if !is_supported_text_path(path) {
        return Err(format!("不支持导入该文件类型：{}", path.display()));
    }
    let metadata = path
        .metadata()
        .map_err(|error| format!("读取文件信息失败: {error}"))?;
    if metadata.len() > MAX_SOURCE_BYTES {
        return Err(format!("单个知识库文件不能超过 2 MB：{}", path.display()));
    }
    let bytes = fs::read(path).map_err(|error| format!("读取知识库文件失败: {error}"))?;
    if bytes.iter().take(8192).any(|byte| *byte == 0) {
        return Err(format!("知识库暂不支持二进制文件：{}", path.display()));
    }
    String::from_utf8(bytes).map_err(|_| format!("知识库文件必须是 UTF-8：{}", path.display()))
}

fn is_supported_text_path(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    matches!(
        extension.as_str(),
        "txt"
            | "md"
            | "markdown"
            | "rs"
            | "ts"
            | "tsx"
            | "js"
            | "jsx"
            | "py"
            | "java"
            | "kt"
            | "go"
            | "c"
            | "cc"
            | "cpp"
            | "h"
            | "hpp"
            | "cs"
            | "sql"
            | "json"
            | "yaml"
            | "yml"
            | "toml"
            | "xml"
            | "html"
            | "css"
            | "scss"
            | "sh"
            | "ps1"
            | "bat"
            | "cmd"
            | "properties"
            | "ini"
            | "conf"
            | "log"
            | "csv"
    )
}

fn split_text(content: &str, chunk_size: usize, overlap: usize) -> Vec<String> {
    let chars = content.chars().collect::<Vec<_>>();
    if chars.is_empty() {
        return Vec::new();
    }
    let chunk_size = chunk_size.clamp(200, 4000);
    let overlap = overlap.min(chunk_size / 2);
    let mut chunks = Vec::new();
    let mut start = 0usize;
    while start < chars.len() {
        let mut end = (start + chunk_size).min(chars.len());
        if end < chars.len() {
            let search_start = (end.saturating_sub(220)).max(start + chunk_size / 2);
            if let Some(relative) = chars[search_start..end]
                .iter()
                .rposition(|character| *character == '\n')
            {
                end = search_start + relative + 1;
            }
        }
        let chunk = chars[start..end]
            .iter()
            .collect::<String>()
            .trim()
            .to_string();
        if !chunk.is_empty() {
            chunks.push(chunk);
        }
        if end >= chars.len() {
            break;
        }
        start = end.saturating_sub(overlap);
    }
    chunks
}

fn local_embedding(content: &str) -> Vec<f32> {
    let mut vector = vec![0f32; EMBEDDING_DIMENSIONS];
    for token in tokenize(content) {
        let digest = Sha256::digest(token.as_bytes());
        let index = u16::from_be_bytes([digest[0], digest[1]]) as usize % EMBEDDING_DIMENSIONS;
        let sign = if digest[2] & 1 == 0 { 1.0 } else { -1.0 };
        vector[index] += sign;
    }
    let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    if norm > 0.0 {
        for value in &mut vector {
            *value /= norm;
        }
    }
    vector
}

fn tokenize(content: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut ascii = String::new();
    for character in content.to_lowercase().chars() {
        if character.is_ascii_alphanumeric() || character == '_' {
            ascii.push(character);
            continue;
        }
        if !ascii.is_empty() {
            tokens.push(std::mem::take(&mut ascii));
        }
        if !character.is_whitespace() && !character.is_ascii_punctuation() {
            tokens.push(character.to_string());
        }
    }
    if !ascii.is_empty() {
        tokens.push(ascii);
    }
    tokens
}

fn dot_product(left: &[f32], right: &[f32]) -> f32 {
    left.iter()
        .zip(right)
        .map(|(left, right)| left * right)
        .sum()
}

fn content_hash(content: &str) -> String {
    format!("{:x}", Sha256::digest(content.as_bytes()))
}

fn ensure_knowledge_base(connection: &Connection, id: &str) -> Result<(), String> {
    let exists = connection
        .query_row(
            "SELECT 1 FROM ai_knowledge_bases WHERE id = ?1",
            params![id],
            |_| Ok(()),
        )
        .optional()
        .map_err(database_error)?
        .is_some();
    if exists {
        Ok(())
    } else {
        Err("知识库不存在".to_string())
    }
}

fn knowledge_chunk_settings(connection: &Connection, id: &str) -> Result<(usize, usize), String> {
    connection
        .query_row(
            "SELECT chunk_size, chunk_overlap FROM ai_knowledge_bases WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?.max(200) as usize,
                    row.get::<_, i64>(1)?.max(0) as usize,
                ))
            },
        )
        .map_err(|_| "知识库不存在".to_string())
}

fn mark_source_error(connection: &Connection, source_id: &str, error: &str) -> Result<(), String> {
    connection
        .execute(
            "UPDATE ai_knowledge_sources SET status = 'error', error_message = ?2, updated_at = ?3 WHERE id = ?1",
            params![source_id, error, Utc::now().to_rfc3339()],
        )
        .map(|_| ())
        .map_err(database_error)
}

fn touch_knowledge_base(connection: &Connection, id: &str) -> Result<(), String> {
    connection
        .execute(
            "UPDATE ai_knowledge_bases SET updated_at = ?2 WHERE id = ?1",
            params![id, Utc::now().to_rfc3339()],
        )
        .map(|_| ())
        .map_err(database_error)
}

fn required_name(value: &str, message: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(message.to_string());
    }
    if value.chars().count() > 120 {
        return Err("名称不能超过 120 个字符".to_string());
    }
    Ok(value.to_string())
}

fn database_error(error: rusqlite::Error) -> String {
    format!("知识库数据库操作失败: {error}")
}

#[cfg(test)]
mod tests {
    use super::{
        create_knowledge_base, import_knowledge_sources, local_embedding, rebuild_knowledge_base,
        search_knowledge, split_text, update_knowledge_base, CreateKnowledgeBaseRequest,
        ImportKnowledgeSourceRequest, UpdateKnowledgeBaseRequest,
    };
    use crate::ordinary_chat::storage::initialize_database;
    use rusqlite::{params, Connection};
    use std::fs;
    use uuid::Uuid;

    #[test]
    fn splits_long_text_with_overlap() {
        let text = (0..120)
            .map(|index| format!("第 {index} 行内容\n"))
            .collect::<String>();
        let chunks = split_text(&text, 400, 60);
        assert!(chunks.len() > 1);
        assert!(chunks.iter().all(|chunk| chunk.chars().count() <= 400));
    }

    #[test]
    fn local_embedding_is_normalized() {
        let vector = local_embedding("CodeM 普通聊天知识库检索");
        let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 0.001);
    }

    #[test]
    fn search_reports_invalid_database_rows() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();
        let knowledge_base = create_knowledge_base(
            &connection,
            CreateKnowledgeBaseRequest {
                name: "测试知识库".to_string(),
                description: String::new(),
            },
        )
        .unwrap();
        let knowledge_base_id = knowledge_base["summary"]["id"].as_str().unwrap();
        connection
            .execute(
                "INSERT INTO ai_knowledge_sources
                 (id, knowledge_base_id, kind, name, content_hash, status, chunk_count, created_at, updated_at)
                 VALUES('source-1', ?1, 'text', '损坏来源', 'hash', 'ready', 1, 'now', 'now')",
                [knowledge_base_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO ai_knowledge_chunks
                 (id, knowledge_base_id, source_id, chunk_index, content, token_estimate, metadata_json, created_at)
                 VALUES('chunk-1', ?1, 'source-1', 0, X'80', 1, '{}', 'now')",
                [knowledge_base_id],
            )
            .unwrap();

        let error =
            search_knowledge(&connection, &[knowledge_base_id.to_string()], "查询", 6).unwrap_err();
        assert!(error.contains("知识库数据库操作失败"));
    }

    #[test]
    fn knowledge_rebuild_and_chunk_settings_roll_back_together() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();
        let knowledge_base = create_knowledge_base(
            &connection,
            CreateKnowledgeBaseRequest {
                name: "事务知识库".to_string(),
                description: "原描述".to_string(),
            },
        )
        .unwrap();
        let knowledge_base_id = knowledge_base["summary"]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let path = std::env::temp_dir().join(format!(
            "codem-ordinary-chat-knowledge-{}.txt",
            Uuid::new_v4()
        ));
        fs::write(&path, "知识库事务测试内容。".repeat(180)).unwrap();
        import_knowledge_sources(
            &mut connection,
            &knowledge_base_id,
            ImportKnowledgeSourceRequest {
                path: Some(path.to_string_lossy().to_string()),
                text: None,
                name: None,
            },
        )
        .unwrap();
        let original_chunks = connection
            .prepare(
                "SELECT chunk_index, content FROM ai_knowledge_chunks
                 WHERE knowledge_base_id = ?1 ORDER BY chunk_index",
            )
            .unwrap()
            .query_map([&knowledge_base_id], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        connection
            .execute_batch(
                "CREATE TRIGGER fail_knowledge_chunk_rebuild
                 BEFORE INSERT ON ai_knowledge_chunks
                 BEGIN
                   SELECT RAISE(ABORT, 'forced chunk rebuild failure');
                 END;",
            )
            .unwrap();

        let update_error = update_knowledge_base(
            &connection,
            &knowledge_base_id,
            UpdateKnowledgeBaseRequest {
                name: None,
                description: Some("不应提交".to_string()),
                chunk_size: Some(800),
                chunk_overlap: Some(100),
            },
        )
        .unwrap_err();
        assert!(update_error.contains("forced chunk rebuild failure"));
        let settings = connection
            .query_row(
                "SELECT description, chunk_size, chunk_overlap FROM ai_knowledge_bases WHERE id = ?1",
                [&knowledge_base_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(settings, ("原描述".to_string(), 1200, 180));

        let rebuild_error = rebuild_knowledge_base(&connection, &knowledge_base_id).unwrap_err();
        assert!(rebuild_error.contains("forced chunk rebuild failure"));
        let current_chunks = connection
            .prepare(
                "SELECT chunk_index, content FROM ai_knowledge_chunks
                 WHERE knowledge_base_id = ?1 ORDER BY chunk_index",
            )
            .unwrap()
            .query_map(params![knowledge_base_id], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(current_chunks, original_chunks);
        let _ = fs::remove_file(path);
    }
}
