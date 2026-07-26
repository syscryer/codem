use serde_json::Value;
use std::{collections::HashMap, fmt};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    sync::oneshot,
};

pub const MAX_PI_RPC_LINE_BYTES: usize = 4 * 1024 * 1024;
const PI_RPC_READ_CHUNK_BYTES: usize = 8 * 1024;

#[derive(Debug)]
pub struct PiRpcError {
    message: String,
}

impl PiRpcError {
    fn protocol(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for PiRpcError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for PiRpcError {}

pub struct PiJsonlReader<R> {
    reader: R,
    buffer: Vec<u8>,
}

impl<R: AsyncRead + Unpin> PiJsonlReader<R> {
    pub fn new(reader: R) -> Self {
        Self {
            reader,
            buffer: Vec::new(),
        }
    }

    pub async fn read_value(&mut self) -> Result<Value, PiRpcError> {
        loop {
            if let Some(newline) = self.buffer.iter().position(|byte| *byte == b'\n') {
                let mut record = self.buffer.drain(..=newline).collect::<Vec<_>>();
                record.pop();
                if record.last() == Some(&b'\r') {
                    record.pop();
                }
                if record.is_empty() {
                    continue;
                }
                return parse_record(&record);
            }
            if self.buffer.len() > MAX_PI_RPC_LINE_BYTES {
                return Err(PiRpcError::protocol("Pi RPC 单条消息过大"));
            }

            let mut chunk = [0_u8; PI_RPC_READ_CHUNK_BYTES];
            let read = self
                .reader
                .read(&mut chunk)
                .await
                .map_err(|error| PiRpcError::protocol(format!("读取 Pi RPC 失败: {error}")))?;
            if read == 0 {
                if self.buffer.is_empty() {
                    return Err(PiRpcError::protocol("Pi RPC 输出已结束"));
                }
                let record = std::mem::take(&mut self.buffer);
                return parse_record(&record);
            }
            self.buffer.extend_from_slice(&chunk[..read]);
        }
    }
}

fn parse_record(record: &[u8]) -> Result<Value, PiRpcError> {
    if record.len() > MAX_PI_RPC_LINE_BYTES {
        return Err(PiRpcError::protocol("Pi RPC 单条消息过大"));
    }
    serde_json::from_slice(record)
        .map_err(|error| PiRpcError::protocol(format!("Pi RPC JSON 无效: {error}")))
}

#[derive(Default)]
pub struct PiResponseRouter {
    pending: HashMap<String, oneshot::Sender<Value>>,
}

impl PiResponseRouter {
    pub fn register(&mut self, id: &str) -> Result<oneshot::Receiver<Value>, PiRpcError> {
        if id.trim().is_empty() {
            return Err(PiRpcError::protocol("Pi RPC 请求 ID 不能为空"));
        }
        let (sender, receiver) = oneshot::channel();
        if self.pending.insert(id.to_string(), sender).is_some() {
            return Err(PiRpcError::protocol("Pi RPC 请求 ID 重复"));
        }
        Ok(receiver)
    }

    pub fn route(&mut self, value: Value) -> Result<Option<Value>, PiRpcError> {
        if value.get("type").and_then(Value::as_str) != Some("response") {
            return Ok(Some(value));
        }
        let id = value
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| PiRpcError::protocol("Pi RPC response 缺少请求 ID"))?;
        let sender = self
            .pending
            .remove(id)
            .ok_or_else(|| PiRpcError::protocol(format!("Pi RPC response 请求 ID 未知: {id}")))?;
        sender
            .send(value)
            .map_err(|_| PiRpcError::protocol("Pi RPC response 接收端已关闭"))?;
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::{PiJsonlReader, PiResponseRouter, MAX_PI_RPC_LINE_BYTES};
    use serde_json::json;
    use tokio::io::{duplex, AsyncWriteExt};

    #[tokio::test]
    async fn pi_jsonl_reader_handles_fragmented_lf_records_and_unicode_separators() {
        let (mut writer, reader) = duplex(256);
        let write = tokio::spawn(async move {
            writer
                .write_all("{\"type\":\"event\",\"text\":\"a\u{2028}".as_bytes())
                .await
                .unwrap();
            tokio::task::yield_now().await;
            writer
                .write_all("b\"}\n{\"type\":\"event\",\"text\":\"c\"}\r\n".as_bytes())
                .await
                .unwrap();
        });
        let mut reader = PiJsonlReader::new(reader);

        assert_eq!(
            reader.read_value().await.unwrap(),
            json!({"type": "event", "text": "a\u{2028}b"})
        );
        assert_eq!(
            reader.read_value().await.unwrap(),
            json!({"type": "event", "text": "c"})
        );
        write.await.unwrap();
    }

    #[tokio::test]
    async fn pi_jsonl_reader_rejects_invalid_and_oversized_records() {
        let invalid = b"{not-json}\n";
        let mut reader = PiJsonlReader::new(&invalid[..]);
        assert!(reader
            .read_value()
            .await
            .unwrap_err()
            .to_string()
            .contains("JSON"));

        let oversized = format!("{{\"value\":\"{}\"}}\n", "x".repeat(MAX_PI_RPC_LINE_BYTES));
        let mut reader = PiJsonlReader::new(oversized.as_bytes());
        assert!(reader
            .read_value()
            .await
            .unwrap_err()
            .to_string()
            .contains("过大"));
    }

    #[tokio::test]
    async fn pi_response_router_correlates_out_of_order_responses_and_keeps_events() {
        let mut router = PiResponseRouter::default();
        let first = router.register("req-1").unwrap();
        let second = router.register("req-2").unwrap();

        let event = json!({"type": "message_update", "delta": "hello"});
        assert_eq!(router.route(event.clone()).unwrap(), Some(event));
        assert_eq!(
            router
                .route(json!({
                    "id": "req-2",
                    "type": "response",
                    "command": "get_state",
                    "success": true
                }))
                .unwrap(),
            None
        );
        assert_eq!(
            router
                .route(json!({
                    "id": "req-1",
                    "type": "response",
                    "command": "get_available_models",
                    "success": true
                }))
                .unwrap(),
            None
        );

        assert_eq!(second.await.unwrap()["id"], "req-2");
        assert_eq!(first.await.unwrap()["id"], "req-1");
    }
}
