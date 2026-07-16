import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sidebarSource = readFileSync(new URL('../components/SidebarProjects.tsx', import.meta.url), 'utf8');
const gitHistorySource = readFileSync(new URL('../components/GitHistoryPanel.tsx', import.meta.url), 'utf8');
const workbenchSource = readFileSync(new URL('../components/RightWorkbench.tsx', import.meta.url), 'utf8');
const conversationSource = readFileSync(new URL('../components/ConversationTurn.tsx', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('sidebar rows derive temporary context state from their own open menu target', () => {
  assert.match(sidebarSource, /threadMenuThreadId === thread\.id \? ' context-active'/);
  assert.match(sidebarSource, /ordinaryChatMenuId === chat\.id \? ' context-active'/);
  assert.match(sidebarSource, /projectMenuProjectId === project\.id \? ' context-active'/);
  assert.match(sidebarSource, /selector: '\.thread-menu-popover', onDismiss: \(\) => setThreadMenuThreadId\(null\)/);
  assert.match(sidebarSource, /selector: '\.ordinary-chat-sidebar-menu-popover', onDismiss: \(\) => setOrdinaryChatMenuId\(null\)/);
  assert.match(sidebarSource, /selector: '\.project-menu-popover', onDismiss: \(\) => setProjectMenuProjectId\(null\)/);
});

test('other list-like context menus expose their menu target without replacing active content', () => {
  assert.match(gitHistorySource, /branchContextMenu\?\.branch\.name === branch\.name \? ' context-active'/);
  assert.match(workbenchSource, /workbench-preview-tab-shell[\s\S]*?contextMenu\?\.key === tab\.key \? ' context-active'/);
  assert.match(workbenchSource, /workbench-preview-overflow-item[\s\S]*?contextMenu\?\.key === tab\.key \? ' context-active'/);
  assert.match(conversationSource, /conversation-output-file-item\$\{contextMenu \? ' context-active'/);
  assert.match(conversationSource, /contextMenu\?\.file\.path === file\.path \? ' context-active'/);
  assert.match(workbenchSource, /workbench-tree-row[\s\S]*?contextActive \? ' context-active'/);
});

test('temporary context targets use the shared themed highlight treatment', () => {
  const selectors = [
    '.sidebar-project.context-active .sidebar-project-row',
    '.sidebar-thread-row.context-active:not(.active) .sidebar-thread',
    '.workbench-preview-tab-shell.context-active:not(.active) .workbench-preview-tab',
    '.workbench-preview-overflow-item.context-active:not(.active)',
    '.workbench-tree-row.context-active',
    '.git-history-branch-row.context-active:not(.active)',
    '.conversation-output-file-item.context-active',
    '.changed-files-summary-row.context-active',
  ];

  for (const selector of selectors) {
    const selectorStart = stylesSource.indexOf(selector);
    assert.ok(selectorStart >= 0, `missing context target selector: ${selector}`);
    const ruleEnd = stylesSource.indexOf('}', selectorStart);
    const rule = stylesSource.slice(selectorStart, ruleEnd + 1);
    assert.match(rule, /background:/, `missing context target background: ${selector}`);
    assert.doesNotMatch(rule, /box-shadow:/, `context target should not draw an outline: ${selector}`);
    assert.doesNotMatch(rule, /var\(--accent\)/, `context target should use a neutral background: ${selector}`);
  }
});
