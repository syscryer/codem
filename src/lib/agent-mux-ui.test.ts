import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { groupAgentMuxRunsByWorkspace } from './agent-mux-workspaces';

const componentSource = readFileSync(new URL('../components/AgentMuxPrototype.tsx', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('./agent-mux-api.ts', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const cliSource = readFileSync(new URL('../../src-tauri/src/bin/codem-agent-mux.rs', import.meta.url), 'utf8');

test('Agent Mux exposes OpenCode configuration without claiming independent runtime support', () => {
  assert.match(componentSource, /agentId === 'opencode' \? OPENCODE_PROVIDER_ID/);
  assert.match(componentSource, /providerId === OPENCODE_PROVIDER_ID/);
  assert.match(apiSource, /agentId === 'opencode'[\s\S]*?probeOpenCodeAgent\(\)/);
  assert.match(componentSource, /\['codex', 'grok'\]\.includes\(agent\.id\)/);
  assert.match(componentSource, /className="agent-mux-health-list"[\s\S]*?\{agentItems\.map\(/);
  assert.doesNotMatch(componentSource, /agentItems\.slice\(0,\s*4\)/);
  assert.match(apiSource, /prompt: string;/);
  assert.match(componentSource, /className="agent-mux-agent-mark small" data-provider=\{agent\.id\}><AgentProviderIcon/);
  assert.match(componentSource, /className="agent-mux-agent-mark" data-provider=\{agent\.id\}><AgentProviderIcon/);
  assert.match(componentSource, /className="agent-mux-provider-mark" data-provider=\{agentId\}><AgentProviderIcon/);
});

test('Agent Mux overview rows open the selected monitor run', () => {
  assert.match(componentSource, /onOpenRun=\{\(runId\) => \{ selectedRunIdRef\.current = runId; setSelectedRunId\(runId\); setView\('monitor'\); \}\}/);
  assert.match(componentSource, /className="agent-mux-call-row" onClick=\{onOpen\}/);
});

test('Agent Mux monitor shows provider icons in run rows and details', () => {
  assert.match(componentSource, /<MonitorView agents=\{agentRecords\}/);
  assert.match(componentSource, /className="agent-mux-agent-mark small" data-provider=\{agentId\}><AgentProviderIcon/);
  assert.match(componentSource, /className="agent-mux-detail-title"[\s\S]*?className="agent-mux-agent-mark" data-provider=\{selectedAgentId\}><AgentProviderIcon/);
  assert.match(stylesSource, /\.agent-mux-monitor-page \.agent-mux-run-summary \{ margin: 12px 0; padding: 8px 0; \}/);
  assert.match(stylesSource, /\.agent-mux-monitor-page \.agent-mux-detail-heading \.agent-mux-run-prompt p \{ max-height: 56px; \}/);
});

test('run detail shows the immutable prompt and no empty More menu remains', () => {
  assert.match(componentSource, /<span>调用提示词<\/span><p>\{selected\.prompt \|\| '旧记录未保存原始提示词'\}<\/p>/);
  assert.doesNotMatch(componentSource, /MoreHorizontal/);
  assert.doesNotMatch(componentSource, />更多<\/button>/);
});

test('Agent Mux confirmations use the themed app dialog instead of browser confirm', () => {
  assert.doesNotMatch(componentSource, /window\.confirm/);
  assert.match(componentSource, /className="dialog-backdrop agent-mux-confirm-backdrop"/);
  assert.match(componentSource, /tone: 'primary'/);
  assert.match(componentSource, /tone: 'danger'/);
});

test('Agent Mux runtime uses an accessible stop icon and keeps long paths visible', () => {
  assert.match(componentSource, /className="agent-mux-stop-button agent-mux-runtime-stop-button"[^>]*title="停止 Runtime"[^>]*aria-label="停止 Runtime"/);
  assert.match(stylesSource, /\.agent-mux-run-item > span \{[^}]*flex-direction: column/);
  assert.match(stylesSource, /\.agent-mux-agent-copy strong, \.agent-mux-run-item strong \{[^}]*white-space: nowrap/);
  assert.match(stylesSource, /\.agent-mux-runtime-status small \{[^}]*overflow-wrap: anywhere/);
  assert.match(stylesSource, /\.agent-mux-skill-source-row small \{[^}]*overflow-wrap: anywhere/);
  assert.match(stylesSource, /\.agent-mux-skill-source-actions \{[^}]*grid-column: 2/);
});

test('Agent Mux profile table prioritizes the profile name and exposes its full value', () => {
  assert.match(stylesSource, /grid-template-columns: minmax\(210px, 2\.4fr\) minmax\(44px, \.45fr\) minmax\(50px, \.5fr\) minmax\(44px, \.45fr\) minmax\(108px, auto\)/);
  assert.match(componentSource, /<strong title=\{profileName\}>\{profileName\}<\/strong>/);
});

test('Agent Mux groups runs by existing workspace and preserves unmatched history', () => {
  const groups = groupAgentMuxRunsByWorkspace([
    { id: 'matched', workingDirectory: 'd:/ai_proj/codem/' },
    { id: 'external', workingDirectory: 'D:\\other\\repo' },
    { id: 'legacy', workingDirectory: null },
  ], [{ name: 'CodeM', path: 'D:\\ai_proj\\codem' }]);

  assert.deepEqual(groups.map((group) => [group.name, group.path, group.runs.map((run) => run.id)]), [
    ['CodeM', 'd:/ai_proj/codem/', ['matched']],
    ['repo', 'D:\\other\\repo', ['external']],
    ['未关联工作区', '未记录工作目录', ['legacy']],
  ]);
  assert.match(componentSource, /className="agent-mux-workspace-group-head" aria-expanded=\{expanded\}/);
});

test('Agent Mux uses the standard themed dropdown instead of native selects', () => {
  assert.doesNotMatch(componentSource, /<select\b/);
  assert.match(componentSource, /import \{ StandardSelect \} from '\.\/StandardSelect'/);
  assert.match(componentSource, /<StandardSelect[\s\S]*?triggerClassName="agent-mux-select-trigger"/);
});

test('global add profile allows selecting an agent while scoped profile actions stay locked', () => {
  assert.match(componentSource, /setProfileDialog\(\{ agentId: selectedAgent\.id, allowAgentSelection: true \}\)/);
  assert.match(componentSource, /allowAgentSelection \? <StandardSelect ariaLabel="选择 Agent 类型"/);
  assert.match(componentSource, /onAddProfile=\{\(\) => setProfileDialog\(\{ agentId: selectedAgent\.id \}\)\}/);
  assert.match(componentSource, /onEditProfile=\{\(profile\) => setProfileDialog\(\{ agentId: selectedAgent\.id, profile \}\)\}/);
});

test('Agent Mux skill records the caller agent without requesting a session name', () => {
  assert.match(componentSource, /--caller '<当前主 Agent 名称>'/);
  assert.match(componentSource, /--app-data/);
  assert.match(apiSource, /appDataDir: string/);
  assert.match(componentSource, /不要填写或推测会话名称/);
});

test('Agent Mux profiles default reasoning to the model and pass explicit choices through', () => {
  assert.match(componentSource, /<span>思考等级 <em>默认跟随模型<\/em><\/span>/);
  assert.match(componentSource, /profile\?\.reasoningEffort \?\? ''/);
  assert.match(componentSource, /reasoningEffort: reasoningEffort \|\| null/);
  assert.match(componentSource, /reasoningEffort: input\.profile\.reasoningEffort/);
  assert.match(apiSource, /reasoningEffort: input\.reasoningEffort \|\| undefined/);
  assert.match(cliSource, /profile\.get\("reasoningEffort"\)/);
  assert.match(cliSource, /"reasoningEffort": reasoning_effort/);
});
