import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { shouldFreezePersistentHiddenView } from '../components/PersistentHiddenView.js';
import { areThreadRuntimeStatusesEqual } from './thread-runtime-statuses.js';

const appMenubarSource = readFileSync(new URL('../components/AppMenubar.tsx', import.meta.url), 'utf8');
const chatHeaderSource = readFileSync(new URL('../components/ChatHeader.tsx', import.meta.url), 'utf8');
const ordinaryChatHeaderSource = readFileSync(new URL('../components/OrdinaryChatHeader.tsx', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const turnSource = readFileSync(new URL('../components/ConversationTurn.tsx', import.meta.url), 'utf8');

test('macOS 不再注册会随光标合成更新的 CSS app-region', () => {
  assert.doesNotMatch(stylesSource, /-webkit-app-region\s*:/);
});

test('桌面标题栏继续通过 Tauri 原生拖拽 API 工作', () => {
  assert.match(appMenubarSource, /data-tauri-drag-region/);
  assert.match(appMenubarSource, /onPointerDown=\{handleDragStart\}/);
  assert.match(appMenubarSource, /getCurrentWindow\(\)\.startDragging\(\)/);
});

test('聊天标题栏保留 Tauri 拖拽标记', () => {
  assert.match(chatHeaderSource, /<header className="chat-header" data-tauri-drag-region>/);
  assert.match(ordinaryChatHeaderSource, /<header className="chat-header ordinary-chat-header" data-tauri-drag-region>/);
});

test('隐藏工作区只在重新显示时接收最新渲染', () => {
  assert.equal(shouldFreezePersistentHiddenView(false, false), false);
  assert.equal(shouldFreezePersistentHiddenView(false, true), false);
  assert.equal(shouldFreezePersistentHiddenView(true, true), true);
  assert.equal(shouldFreezePersistentHiddenView(true, false), false);
  assert.match(appSource, /<PersistentHiddenView hidden=\{appView\.kind === 'settings'\}>/);
});

test('Claude 流式阶段保留完整 Markdown，并跳过相同 deferred 内容的重复解析', () => {
  assert.match(turnSource, /const DeferredMarkdownContent = memo\(function DeferredMarkdownContent/);
  assert.match(turnSource, /return <DeferredMarkdownContent content=\{deferredContent\} onPreviewImage=\{onPreviewImage\} \/>;/);
  assert.match(turnSource, /<ReactMarkdown[\s\S]*?\{content\}\s*<\/ReactMarkdown>/);
  assert.doesNotMatch(turnSource, /if \(streaming\)/);
});

test('相同 runtime 状态不会触发 App 重渲染', () => {
  const status = {
    threadId: 'thread-1',
    pid: 123,
    alive: true,
    activeRun: false,
    runtimeKind: 'claude' as const,
  };

  assert.equal(areThreadRuntimeStatusesEqual({ 'thread-1': status }, { 'thread-1': { ...status } }), true);
  assert.equal(
    areThreadRuntimeStatusesEqual({ 'thread-1': status }, { 'thread-1': { ...status, activeRun: true } }),
    false,
  );
  assert.equal(areThreadRuntimeStatusesEqual({ 'thread-1': status }, {}), false);
  assert.match(appSource, /areThreadRuntimeStatusesEqual\(current, statuses\) \? current : statuses/);
});
