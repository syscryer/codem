import assert from 'node:assert/strict';
import test from 'node:test';
import { formatUpdateDownloadProgress } from './settings-runtime';

test('formatUpdateDownloadProgress reports generic progress when size is unknown', () => {
  const state = { downloaded: 0, total: 0 };

  const message = formatUpdateDownloadProgress({ event: 'Started', data: {} }, state);

  assert.equal(message, '正在下载更新包...');
  assert.deepEqual(state, { downloaded: 0, total: 0 });
});

test('formatUpdateDownloadProgress reports percentage when total size is known', () => {
  const state = { downloaded: 0, total: 0 };

  formatUpdateDownloadProgress({ event: 'Started', data: { contentLength: 100 } }, state);
  const message = formatUpdateDownloadProgress({ event: 'Progress', data: { chunkLength: 25 } }, state);

  assert.equal(message, '正在下载更新包... 25%');
  assert.deepEqual(state, { downloaded: 25, total: 100 });
});

test('formatUpdateDownloadProgress stops at downloaded before explicit installation', () => {
  const state = { downloaded: 100, total: 100 };

  const message = formatUpdateDownloadProgress({ event: 'Finished' }, state);

  assert.equal(message, '更新包下载完成');
});
