import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serviceWorker = readFileSync(new URL('../../public/mobile-sw.js', import.meta.url), 'utf8');
const bootstrap = readFileSync(new URL('../../public/mobile-bootstrap.js', import.meta.url), 'utf8');
const mobileApp = readFileSync(new URL('./MobileApp.tsx', import.meta.url), 'utf8');
const mobileCss = readFileSync(new URL('./mobile.css', import.meta.url), 'utf8');
const backend = readFileSync(new URL('../../src-tauri/src/mobile_companion.rs', import.meta.url), 'utf8');

test('mobile service worker replaces stale shells without caching versioned assets', () => {
  assert.match(serviceWorker, /codem-mobile-shell-v5/);
  assert.match(serviceWorker, /self\.skipWaiting\(\)/);
  assert.match(serviceWorker, /cache: 'no-store'/);
  assert.match(serviceWorker, /mobile-offline\.html/);
  assert.doesNotMatch(serviceWorker, /cacheableAsset/);
  assert.doesNotMatch(serviceWorker, /cache\.put\(event\.request/);
});

test('mobile startup only enables PWA behavior in secure browser contexts', () => {
  assert.match(bootstrap, /getRegistrations\(\)/);
  assert.match(bootstrap, /registration\.unregister\(\)/);
  assert.match(bootstrap, /registration\.scope !== mobileScope/);
  assert.match(bootstrap, /getRegistration\('\/mobile\/'\)/);
  assert.match(bootstrap, /codem-recover/);
  assert.match(mobileApp, /updateViaCache: 'none'/);
  assert.match(mobileApp, /scope: '\/mobile\/'/);
  assert.match(mobileApp, /getRegistration\('\/mobile\/'\)/);
  assert.match(mobileApp, /SKIP_WAITING/);
  assert.match(mobileApp, /controllerchange/);
  assert.match(mobileApp, /window\.isSecureContext/);
});

test('missing hashed assets cannot fall back to the application html', () => {
  assert.match(backend, /nest_service\("\/assets", ServeDir::new\(static_dir\.join\("assets"\)\)\)/);
  assert.match(backend, /axum::serve\(listener, app\.into_make_service\(\)\)/);
  assert.match(backend, /\/api\/mobile\/auth\/login/);
  assert.match(backend, /hash_password\(password\)/);
  assert.doesNotMatch(backend, /bind_rustls|pairing_certificate|bootstrap_port|setupUrl|PairingSession/);
});

test('mobile connection card includes padding within the 375px viewport', () => {
  assert.match(mobileCss, /\.mobile-native-connect,\.mobile-native-connect \*[^\{]*\{box-sizing:border-box\}/);
});
