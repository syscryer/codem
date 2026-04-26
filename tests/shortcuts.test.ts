import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildShortcutValue,
  formatShortcut,
  matchesShortcut,
  normalizeShortcutValue,
} from '../src/lib/shortcuts';

test('normalizeShortcutValue trims and lowercases valid shortcuts', () => {
  assert.equal(normalizeShortcutValue(' Ctrl + Shift + D '), 'ctrl+shift+d');
  assert.equal(normalizeShortcutValue('Alt+ArrowDown'), 'alt+arrowdown');
});

test('normalizeShortcutValue rejects bare keys and modifier-only shortcuts', () => {
  assert.equal(normalizeShortcutValue('n'), null);
  assert.equal(normalizeShortcutValue('shift'), null);
  assert.equal(normalizeShortcutValue('ctrl+shift'), null);
});

test('formatShortcut renders compact labels', () => {
  assert.equal(formatShortcut('ctrl+shift+d'), 'Ctrl+Shift+D');
  assert.equal(formatShortcut('alt+arrowdown'), 'Alt+Down');
  assert.equal(formatShortcut(null), '未设置');
});

test('buildShortcutValue captures keyboard events with a real modifier', () => {
  const value = buildShortcutValue({
    key: 'D',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: true,
  });

  assert.equal(value, 'ctrl+shift+d');
});

test('matchesShortcut compares key and modifiers exactly', () => {
  const event = {
    key: 'd',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: true,
  };

  assert.equal(matchesShortcut(event, 'ctrl+shift+d'), true);
  assert.equal(matchesShortcut(event, 'ctrl+d'), false);
});
