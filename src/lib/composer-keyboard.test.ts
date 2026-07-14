import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldSubmitComposerOnEnter } from './composer-keyboard';

const base = {
  key: 'Enter',
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  isComposing: false,
};

test('普通聊天 Composer 的 Enter 发送契约保留换行和输入法组合态', () => {
  assert.equal(shouldSubmitComposerOnEnter(base), true);
  assert.equal(shouldSubmitComposerOnEnter({ ...base, shiftKey: true }), false);
  assert.equal(shouldSubmitComposerOnEnter({ ...base, isComposing: true }), false);
  assert.equal(shouldSubmitComposerOnEnter({ ...base, ctrlKey: true }), false);
  assert.equal(shouldSubmitComposerOnEnter({ ...base, key: 'Tab' }), false);
});
