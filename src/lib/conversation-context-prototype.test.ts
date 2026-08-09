import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const componentSource = readFileSync(
  new URL('../components/ConversationContextPrototype.tsx', import.meta.url),
  'utf8',
);
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const headerSource = readFileSync(new URL('../components/ChatHeader.tsx', import.meta.url), 'utf8');
const paneSource = readFileSync(new URL('../components/ConversationPane.tsx', import.meta.url), 'utf8');
const workspaceStatusSource = readFileSync(new URL('../components/WorkspaceStatus.tsx', import.meta.url), 'utf8');
const popoverSource = readFileSync(new URL('../components/PopoverPortal.tsx', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('conversation context only renders real Agent Mux runs', () => {
  assert.match(componentSource, /agentRuns: AgentMuxRun\[\]/);
  assert.match(componentSource, /groupAgentMuxRunsByConversation\(agentRuns\)\.map\(\(runs\) => runs\[0\]\)/);
  assert.match(componentSource, /conversationRuns\.filter\(\(run\) => run\.status === 'running'/);
  assert.match(componentSource, /conversationRuns\.slice\(0, 3\)/);
  assert.match(componentSource, /conversation-context-agents/);
  assert.doesNotMatch(componentSource, /Claude 子代理|Codex 子代理|原生子代理/);
  assert.match(componentSource, /data-display-mode=/);
  assert.match(appSource, /filterAgentMuxRunsForThread\(overview\.runs, activeThreadId\)/);
});

test('prototype is mounted in the primary conversation and hides for the workbench', () => {
  assert.match(appSource, /!rightWorkbenchOpen \? \(/);
  assert.match(headerSource, /context-island-toggle/);
  assert.doesNotMatch(paneSource, /AgentInvocationGroup|agentMuxRuns/);
  assert.match(appSource, /agentRuns=\{activeThreadAgentMuxRuns\}/);
});

test('Agent rows open their run directly in the right workbench without the old overview tab', () => {
  assert.match(componentSource, /onOpenAgentRun: \(run: AgentMuxRun\) => void/);
  assert.match(componentSource, /onClick=\{onOpen\}/);
  assert.match(appSource, /setRightWorkbenchTab\('agent'\)/);
  assert.match(appSource, /selectedAgentRun=\{selectedAgentMuxRun\}/);
  const workbenchSource = readFileSync(new URL('../components/RightWorkbench.tsx', import.meta.url), 'utf8');
  assert.match(workbenchSource, /<AgentMuxRunDetail/);
  assert.doesNotMatch(workbenchSource, /label="概览"|WorkbenchOverview/);
});

test('conversation context persists display preference and contains no static run fixtures', () => {
  assert.match(componentSource, /localStorage\.setItem\(DISPLAY_MODE_KEY, mode\)/);
  assert.doesNotMatch(componentSource, /GPT-5\.2 Codex|实现会话上下文原型|feature\/agent-context|release\/0\.1\.21/);
});

test('context island only expands when the right rail has enough room', () => {
  assert.match(stylesSource, /@container chat-surface \(max-width: 1579px\)/);
  assert.match(stylesSource, /@container chat-surface \(max-width: 1179px\)[\s\S]*?\.context-island-toggle/);
  assert.match(stylesSource, /\.conversation-context-capsule \{[\s\S]*?margin-left: auto;/);
  assert.match(stylesSource, /--conversation-context-track: max\(0px, calc\(1580px - 100cqi\)\)/);
  assert.doesNotMatch(stylesSource, /data-display-mode="auto"[\s\S]{0,300}--conversation-context-track/);
});

test('context island groups resources into full-width rows', () => {
  assert.equal(componentSource.match(/conversation-context-link-group/g)?.length, 2);
  assert.match(stylesSource, /\.conversation-context-links \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
});

test('context island wires real Git tools and plan progress', () => {
  assert.match(componentSource, /conversation-context-branch-menu/);
  assert.match(componentSource, /conversation-context-progress-list/);
  assert.match(componentSource, /aria-label="选择 Git 分支"/);
  assert.match(componentSource, /plan\.counts\.completed/);
  assert.match(componentSource, /onLoadBranches\(project\.id\)/);
  assert.match(appSource, /getLatestConversationPlanPreview\(activeThread\)/);
  assert.doesNotMatch(appSource, /getLatestTodoWritePreview|normalizeToolName\(tool\.name\)/);
});

test('workspace, Git, and runtime status live in the context island without a footer grid row', () => {
  assert.match(componentSource, /status: ReactNode/);
  assert.match(componentSource, /conversation-context-status/);
  assert.match(componentSource, /conversation-context-non-git/);
  assert.match(appSource, /status=\{\([\s\S]*?<WorkspaceStatus[\s\S]*?variant="island"/);
  assert.equal(appSource.match(/<WorkspaceStatus/g)?.length, 1);
  assert.match(workspaceStatusSource, /variant\?: 'footer' \| 'island'/);
  assert.match(workspaceStatusSource, /popoverAbove \? 'top-start' : 'left-start'/);
  assert.match(workspaceStatusSource, /popoverAbove \? 'top-end' : 'left-start'/);
  assert.match(popoverSource, /'left-start'/);
  assert.match(popoverSource, /sideBoundarySelector/);
  assert.match(popoverSource, /\(sideBoundary\?\.left \?\? rect\.left\) - mw - offset/);
  assert.match(workspaceStatusSource, /sideBoundarySelector=\{popoverAbove \? undefined : '\.conversation-context-island'\}/);
  assert.match(stylesSource, /\.conversation-context-status \.workspace-status \{[\s\S]*?display: grid;/);
  assert.match(stylesSource, /\.terminal-panel \{[\s\S]*?grid-row: 4;/);
});
