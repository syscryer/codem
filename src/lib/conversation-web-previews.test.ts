import assert from 'node:assert/strict';
import test from 'node:test';

import { extractLocalWebPreviewUrls } from './conversation-web-previews.js';

test('extractLocalWebPreviewUrls keeps only exact loopback http urls in first-seen order', () => {
  assert.deepEqual(
    extractLocalWebPreviewUrls([
      '启动于 http://localhost:5173，API: http://127.0.0.1:3000/。',
      '[重复](http://localhost:5173/) https://example.com http://localhost.example.com',
      'IPv6: http://[::1]:8080/docs。',
    ]),
    [
      'http://localhost:5173/',
      'http://127.0.0.1:3000/',
      'http://[::1]:8080/docs',
    ],
  );
});

test('extractLocalWebPreviewUrls rejects credentials unsafe schemes and punctuation-only candidates', () => {
  assert.deepEqual(
    extractLocalWebPreviewUrls([
      'https://user:pass@localhost:5173 file://localhost/a javascript:alert(1)',
    ]),
    [],
  );
});

test('extractLocalWebPreviewUrls trims unmatched markdown delimiters without changing balanced url content', () => {
  assert.deepEqual(
    extractLocalWebPreviewUrls([
      '[服务](http://localhost:4173/path_(draft))，另一个：http://127.0.0.1:8080/docs].',
    ]),
    [
      'http://localhost:4173/path_(draft)',
      'http://127.0.0.1:8080/docs',
    ],
  );
});
