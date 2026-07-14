import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const tauriMainSource = readFileSync(new URL('../../src-tauri/src/main.rs', import.meta.url), 'utf8');
const tauriCargoSource = readFileSync(new URL('../../src-tauri/Cargo.toml', import.meta.url), 'utf8');
const macosTauriConfig = JSON.parse(
  readFileSync(new URL('../../src-tauri/tauri.macos.conf.json', import.meta.url), 'utf8'),
) as {
  app?: {
    macOSPrivateApi?: boolean;
  };
  bundle?: {
    resources?: string[];
  };
};

test('macOS packaging does not bundle the legacy Node backend resources', () => {
  assert.deepEqual(macosTauriConfig.bundle?.resources, []);
});

test('macOS private API config enables the matching Tauri cargo feature', () => {
  assert.equal(macosTauriConfig.app?.macOSPrivateApi, true);
  assert.match(tauriCargoSource, /tauri\s*=\s*\{[^}]*features\s*=\s*\[[^\]]*"macos-private-api"/s);
});

test('desktop shell uses the in-process Rust backend without legacy child cleanup', () => {
  assert.match(tauriMainSource, /\.build\(tauri::generate_context!\(\)\)/);
  assert.match(tauriMainSource, /\.run\(\|_?app_handle,\s*_?event\|/);
  assert.doesNotMatch(tauriMainSource, /cleanup_managed_backend_processes/);
  assert.doesNotMatch(tauriMainSource, /stop_managed_backend_child_process/);
  assert.doesNotMatch(tauriMainSource, /stop_managed_backend_pty_process/);
});

test('desktop shell passes an app-scoped data directory to the backend', () => {
  assert.match(tauriMainSource, /const BACKEND_APP_DATA_DIR_ENV: &str = "CODEM_APP_DATA_DIR"/);
  assert.match(tauriMainSource, /fn backend_app_data_dir\(app: &tauri::AppHandle\) -> Option<PathBuf>/);
  assert.match(tauriMainSource, /codem::backend::run_blocking_with_config\(backend_port,\s*app_data_dir\)/s);
});
