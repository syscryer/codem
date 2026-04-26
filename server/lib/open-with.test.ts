import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorLaunchRequest, parseOpenWithArgs } from './open-with.js';

test('createEditorLaunchRequest uses environment and editor fallbacks in auto mode', () => {
  const request = createEditorLaunchRequest(
    { target: 'auto', customCommand: '', customArgs: '' },
    { CODEM_EDITOR: 'custom-editor', VISUAL: 'visual-editor', EDITOR: 'terminal-editor' },
  );

  assert.deepEqual(request.candidates, ['custom-editor', 'visual-editor', 'terminal-editor', 'cursor', 'code']);
  assert.deepEqual(request.args, []);
});

test('createEditorLaunchRequest uses fixed editor candidates', () => {
  assert.deepEqual(
    createEditorLaunchRequest({ target: 'cursor', customCommand: '', customArgs: '' }, {}).candidates,
    ['cursor'],
  );
  assert.deepEqual(
    createEditorLaunchRequest({ target: 'vscode', customCommand: '', customArgs: '' }, {}).candidates,
    ['code'],
  );
});

test('createEditorLaunchRequest keeps custom command and parses custom args', () => {
  const request = createEditorLaunchRequest(
    { target: 'custom', customCommand: 'C:\\Tools\\editor.exe', customArgs: '--reuse-window "--profile default"' },
    {},
  );

  assert.deepEqual(request, {
    candidates: ['C:\\Tools\\editor.exe'],
    args: ['--reuse-window', '--profile default'],
  });
});

test('parseOpenWithArgs tolerates empty and unterminated quoted args', () => {
  assert.deepEqual(parseOpenWithArgs(''), []);
  assert.deepEqual(parseOpenWithArgs('"--profile default'), ['--profile default']);
});
