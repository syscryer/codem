use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

const KEY_FILE_NAME: &str = "ai-secrets.key";
const VAULT_FILE_NAME: &str = "ai-secrets.enc";

#[derive(Clone)]
pub(crate) struct SecretStore {
    root: Arc<PathBuf>,
    lock: Arc<Mutex<()>>,
}

#[derive(Default, Deserialize, Serialize)]
struct SecretPayload {
    secrets: HashMap<String, String>,
}

#[derive(Deserialize, Serialize)]
struct SecretEnvelope {
    version: u32,
    nonce: String,
    ciphertext: String,
}

impl SecretStore {
    pub(crate) fn new(root: PathBuf) -> Self {
        Self {
            root: Arc::new(root),
            lock: Arc::new(Mutex::new(())),
        }
    }

    pub(crate) fn has(&self, slot: &str) -> Result<bool, String> {
        Ok(self.read_payload()?.secrets.contains_key(slot))
    }

    pub(crate) fn get(&self, slot: &str) -> Result<String, String> {
        self.read_payload()?
            .secrets
            .get(slot)
            .cloned()
            .ok_or_else(|| "尚未保存 API Key".to_string())
    }

    pub(crate) fn set(&self, slot: &str, value: &str) -> Result<(), String> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| "API Key 存储锁不可用".to_string())?;
        let mut payload = self.read_payload_unlocked()?;
        payload.secrets.insert(slot.to_string(), value.to_string());
        self.write_payload_unlocked(&payload)
    }

    pub(crate) fn delete(&self, slot: &str) -> Result<(), String> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| "API Key 存储锁不可用".to_string())?;
        let mut payload = self.read_payload_unlocked()?;
        if payload.secrets.remove(slot).is_some() {
            self.write_payload_unlocked(&payload)?;
        }
        Ok(())
    }

    fn read_payload(&self) -> Result<SecretPayload, String> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| "API Key 存储锁不可用".to_string())?;
        self.read_payload_unlocked()
    }

    fn read_payload_unlocked(&self) -> Result<SecretPayload, String> {
        let vault_path = self.root.join(VAULT_FILE_NAME);
        if !vault_path.exists() {
            return Ok(SecretPayload::default());
        }
        let key = self.load_or_create_key()?;
        let envelope: SecretEnvelope = serde_json::from_slice(
            &fs::read(&vault_path).map_err(|error| format!("读取 API Key vault 失败: {error}"))?,
        )
        .map_err(|error| format!("解析 API Key vault 失败: {error}"))?;
        if envelope.version != 1 {
            return Err("API Key vault 版本不受支持".to_string());
        }
        let nonce = STANDARD
            .decode(envelope.nonce)
            .map_err(|_| "API Key vault nonce 无效".to_string())?;
        let ciphertext = STANDARD
            .decode(envelope.ciphertext)
            .map_err(|_| "API Key vault 密文无效".to_string())?;
        let nonce = aes_gcm::Nonce::from_slice(&nonce);
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
        let plaintext = cipher
            .decrypt(nonce, ciphertext.as_ref())
            .map_err(|_| "API Key vault 解密失败".to_string())?;
        serde_json::from_slice(&plaintext)
            .map_err(|error| format!("解析 API Key 数据失败: {error}"))
    }

    fn write_payload_unlocked(&self, payload: &SecretPayload) -> Result<(), String> {
        fs::create_dir_all(self.root.as_ref())
            .map_err(|error| format!("创建 API Key 存储目录失败: {error}"))?;
        let key = self.load_or_create_key()?;
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let plaintext = serde_json::to_vec(payload)
            .map_err(|error| format!("序列化 API Key 数据失败: {error}"))?;
        let ciphertext = cipher
            .encrypt(&nonce, plaintext.as_ref())
            .map_err(|_| "加密 API Key 数据失败".to_string())?;
        let envelope = SecretEnvelope {
            version: 1,
            nonce: STANDARD.encode(nonce),
            ciphertext: STANDARD.encode(ciphertext),
        };
        atomic_write(
            &self.root.join(VAULT_FILE_NAME),
            &serde_json::to_vec(&envelope)
                .map_err(|error| format!("序列化 API Key vault 失败: {error}"))?,
        )
    }

    fn load_or_create_key(&self) -> Result<Vec<u8>, String> {
        let key_path = self.root.join(KEY_FILE_NAME);
        if key_path.exists() {
            let encoded = fs::read_to_string(&key_path)
                .map_err(|error| format!("读取 API Key vault key 失败: {error}"))?;
            let key = STANDARD
                .decode(encoded.trim())
                .map_err(|_| "API Key vault key 无效".to_string())?;
            if key.len() != 32 {
                return Err("API Key vault key 长度无效".to_string());
            }
            return Ok(key);
        }
        fs::create_dir_all(self.root.as_ref())
            .map_err(|error| format!("创建 API Key 存储目录失败: {error}"))?;
        let key = Aes256Gcm::generate_key(&mut OsRng).to_vec();
        atomic_write(&key_path, STANDARD.encode(&key).as_bytes())?;
        Ok(key)
    }
}

fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, contents).map_err(|error| format!("写入临时文件失败: {error}"))?;
    if path.exists() {
        let backup = path.with_extension("bak");
        let _ = fs::copy(path, backup);
        fs::remove_file(path).map_err(|error| format!("替换旧文件失败: {error}"))?;
    }
    fs::rename(&temporary, path).map_err(|error| format!("保存文件失败: {error}"))
}

#[cfg(test)]
mod tests {
    use super::SecretStore;

    #[test]
    fn encrypted_store_roundtrips_without_plaintext() {
        let root = std::env::temp_dir().join(format!("codem-ai-secrets-{}", uuid::Uuid::new_v4()));
        let store = SecretStore::new(root.clone());
        store.set("provider:1", "secret-value").unwrap();
        assert_eq!(store.get("provider:1").unwrap(), "secret-value");
        let encrypted = std::fs::read_to_string(root.join("ai-secrets.enc")).unwrap();
        assert!(!encrypted.contains("secret-value"));
        store.delete("provider:1").unwrap();
        assert!(!store.has("provider:1").unwrap());
        let _ = std::fs::remove_dir_all(root);
    }
}
