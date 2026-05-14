import assert from 'node:assert/strict';
import test from 'node:test';

import { emitPluginsChanged, PLUGINS_CHANGED_EVENT } from '../src/lib/plugins';
import type { SettingsSection } from '../src/types';

test('settings section model includes plugins entry', () => {
  const sections: SettingsSection[] = [
    'basic',
    'appearance',
    'shortcuts',
    'providers',
    'usage',
    'sessions',
    'mcp',
    'plugins',
    'globalPrompts',
    'openWith',
  ];

  assert.ok(sections.includes('plugins'));
});

test('plugin library exports a stable refresh event name', () => {
  assert.equal(PLUGINS_CHANGED_EVENT, 'codem:plugins-changed');
});

test('emitPluginsChanged is a no-op outside browser environments', () => {
  assert.doesNotThrow(() => {
    emitPluginsChanged();
  });
});
