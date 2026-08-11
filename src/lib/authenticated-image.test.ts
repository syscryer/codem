import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { isAuthenticatedApiImage } from '../components/AuthenticatedImage.js';

const componentSource = readFileSync(new URL('../components/AuthenticatedImage.tsx', import.meta.url), 'utf8');
const conversationSource = readFileSync(new URL('../components/ConversationTurn.tsx', import.meta.url), 'utf8');
const dialogSource = readFileSync(new URL('../components/ImagePreviewDialog.tsx', import.meta.url), 'utf8');

test('authenticated image detection is limited to backend preview endpoints', () => {
  assert.equal(isAuthenticatedApiImage('/api/system/image-preview?path=D%3A%5Cimage.png'), true);
  assert.equal(
    isAuthenticatedApiImage('http://127.0.0.1:53252/api/system/attachments/image-preview?path=C%3A%5Cimage.png'),
    true,
  );
  assert.equal(isAuthenticatedApiImage('https://example.com/image.png'), false);
  assert.equal(isAuthenticatedApiImage('data:image/png;base64,AA=='), false);
});

test('backend image previews use authenticated fetch and release object URLs', () => {
  assert.match(componentSource, /fetch\(src, \{ cache: 'no-store', signal: controller\.signal \}\)/);
  assert.match(componentSource, /URL\.createObjectURL\(blob\)/);
  assert.match(componentSource, /URL\.revokeObjectURL\(objectUrl\)/);
  assert.match(conversationSource, /<AuthenticatedImage[\s\S]*?user-message-attachment-preview/);
  assert.match(dialogSource, /<AuthenticatedImage[\s\S]*?image-preview-image/);
});
