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

test('macOS with-node packaging keeps the full dist-server resource tree', () => {
  assert.deepEqual(macosTauriConfig.bundle?.resources, ['../dist-server']);
});

test('macOS private API config enables the matching Tauri cargo feature', () => {
  assert.equal(macosTauriConfig.app?.macOSPrivateApi, true);
  assert.match(tauriCargoSource, /tauri\s*=\s*\{[^}]*features\s*=\s*\[[^\]]*"macos-private-api"/s);
});

test('desktop shell cleans managed backend processes on app exit', () => {
  assert.match(tauriMainSource, /\.build\(tauri::generate_context!\(\)\)/);
  assert.match(tauriMainSource, /\.run\(\|app_handle,\s*event\|/);
  assert.match(tauriMainSource, /tauri::RunEvent::ExitRequested\s*\{\s*\.\.\s*\}\s*\|\s*tauri::RunEvent::Exit/s);
  assert.match(tauriMainSource, /cleanup_managed_backend_processes\(app_handle\)/);
  assert.match(tauriMainSource, /stop_managed_backend_child_process\(&backend_processes\)/);
  assert.match(tauriMainSource, /stop_managed_backend_pty_process\(&backend_processes\)/);
});

test('desktop shell passes an app-scoped data directory to the backend', () => {
  assert.match(tauriMainSource, /const BACKEND_APP_DATA_DIR_ENV: &str = "CODEM_APP_DATA_DIR"/);
  assert.match(tauriMainSource, /fn backend_app_data_dir\(app: &tauri::AppHandle\) -> Option<PathBuf>/);
  assert.match(tauriMainSource, /\.env\(BACKEND_APP_DATA_DIR_ENV,\s*app_data_dir/s);
});
