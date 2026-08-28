import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const componentSource = readFileSync(new URL('./ConversationTurn.tsx', import.meta.url), 'utf8');
const styleSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('long user messages use measured progressive disclosure without changing the stored text', () => {
  assert.match(componentSource, /const USER_MESSAGE_COLLAPSED_HEIGHT = 360/);
  assert.match(componentSource, /content\.scrollHeight > USER_MESSAGE_COLLAPSED_HEIGHT/);
  assert.match(componentSource, /<CollapsibleUserMessage text=\{turn\.userText\} \/>/);
  assert.match(componentSource, /aria-expanded=\{expanded\}/);
  assert.match(componentSource, /expanded \? '收起' : '显示更多'/);
  assert.match(styleSource, /\.user-message-text\.is-collapsed \.message-body/);
  assert.match(styleSource, /\.user-message-expand-footer[\s\S]*linear-gradient/);
});
