import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isTerminalDockActive,
  resolveTerminalDockBodyKind,
  resolveTerminalDockPanelIdOnRun,
  shouldRenderTerminalDock,
} from './terminal-dock-state';

test('只有终端面板实际显示时 CMD 入口才处于活动状态', () => {
  assert.equal(isTerminalDockActive({ isOpen: false, activePanelId: 'terminal' }), false);
  assert.equal(isTerminalDockActive({ isOpen: true, activePanelId: 'git-history' }), false);
  assert.equal(isTerminalDockActive({ isOpen: true, activePanelId: 'terminal' }), true);
});

test('web 端打开额外面板时也应渲染 Dock', () => {
  assert.equal(
    shouldRenderTerminalDock({
      isOpen: true,
      terminalAvailable: false,
      extraPanelIds: ['git-history'],
    }),
    true,
  );
});

test('额外面板激活时优先显示额外面板内容', () => {
  assert.equal(
    resolveTerminalDockBodyKind({
      terminalAvailable: false,
      activePanelId: 'git-history',
      extraPanelIds: ['git-history'],
    }),
    'extra',
  );
});

test('没有终端能力且未激活额外面板时显示不可用占位', () => {
  assert.equal(
    resolveTerminalDockBodyKind({
      terminalAvailable: false,
      activePanelId: 'terminal',
      extraPanelIds: ['git-history'],
    }),
    'unavailable',
  );
});

test('执行启动脚本时应切回终端面板而不是保留 Git 日志', () => {
  assert.equal(resolveTerminalDockPanelIdOnRun(), 'terminal');
});
