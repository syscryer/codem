import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appMenubar = readFileSync(new URL('../components/AppMenubar.tsx', import.meta.url), 'utf8');
const chatHeader = readFileSync(new URL('../components/ChatHeader.tsx', import.meta.url), 'utf8');
const gitDialog = readFileSync(new URL('../components/GitDialog.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('titlebar renders background operation center before update entry', () => {
  assert.match(appMenubar, /<BackgroundOperationCenter[\s\S]*\{updateEntry\}/);
  assert.match(appMenubar, /onOpenBackgroundOperations/);
  assert.match(appMenubar, /onClearCompletedBackgroundOperations/);
});

test('git actions expose running states for fetch pull and push', () => {
  assert.match(chatHeader, /gitOperationRunning/);
  assert.match(chatHeader, /running\.fetch \? '获取中' : '获取远端'/);
  assert.match(chatHeader, /running\.pull \? '拉取中' : '拉取'/);
  assert.match(chatHeader, /running\.push \? '推送中' : '推送'/);
});

test('git push is owned by App so it can outlive the dialog', () => {
  assert.match(app, /async function handleGitPush/);
  assert.match(app, /backgroundOperations\.startOperation/);
  assert.match(gitDialog, /onPush: \(project: ProjectSummary, preview: GitPushPreview\) => Promise<void>/);
  assert.doesNotMatch(gitDialog, /pushGitBranch/);
});

test('background operation styles use theme tokens and reduced motion', () => {
  assert.match(styles, /\.background-operation-popover/);
  assert.match(styles, /var\(--app-surface/);
  assert.match(styles, /var\(--app-border/);
  assert.match(styles, /var\(--danger/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /\.background-operation-popover[\s\S]*animation: none/);
});
