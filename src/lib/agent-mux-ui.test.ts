import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { groupAgentMuxRunsByWorkspace } from './agent-mux-workspaces';
import { filterAgentMuxRunsForThread, type AgentMuxRun } from './agent-mux-api';

const componentSource = readFileSync(new URL('../components/AgentMuxPrototype.tsx', import.meta.url), 'utf8');
const avatarSource = readFileSync(new URL('../components/AgentMuxAvatar.tsx', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('./agent-mux-api.ts', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const cliSource = readFileSync(new URL('../../src-tauri/src/bin/codem-agent-mux.rs', import.meta.url), 'utf8');

test('Agent Mux exposes OpenCode configuration without claiming independent runtime support', () => {
  assert.match(componentSource, /id === 'opencode' \? OPENCODE_PROVIDER_ID/);
  assert.match(componentSource, /providerId === OPENCODE_PROVIDER_ID/);
  assert.match(apiSource, /agentId === 'opencode'[\s\S]*?probeOpenCodeAgent\(\)/);
  assert.match(componentSource, /\['codex', 'grok', 'gemini', 'hermes'\]\.includes\(agent\.id\)/);
  assert.match(componentSource, /className="agent-mux-health-list"[\s\S]*?\{agentItems\.map\(/);
  assert.doesNotMatch(componentSource, /agentItems\.slice\(0,\s*4\)/);
  assert.match(apiSource, /prompt: string;/);
  assert.match(componentSource, /className="agent-mux-agent-mark small" data-provider=\{agent\.id\}><AgentProviderIcon/);
  assert.match(componentSource, /className="agent-mux-agent-mark" data-provider=\{agent\.id\}><AgentProviderIcon/);
  assert.match(componentSource, /<AgentMuxAvatar avatar=\{profile\.avatar\} providerId=\{agentProviderId\(agentId\) \?\? agentId\} size="small"/);
});

test('Agent Mux overview rows open the selected monitor run', () => {
  assert.match(componentSource, /onOpenRun=\{\(runId\) => \{ selectedRunIdRef\.current = runId; setSelectedRunId\(runId\); setView\('monitor'\); \}\}/);
  assert.match(componentSource, /className="agent-mux-call-row" onClick=\{onOpen\}/);
});

test('Agent Mux monitor defaults to the first run without overriding a valid selection', () => {
  assert.match(componentSource, /if \(current && runRecords\.some\(\(run\) => run\.id === current\)\) return current;/);
  assert.match(componentSource, /groupAgentMuxRunsByConversation\(runRecords\)\[0\]\?\.\[0\]\?\.id \?\? ''/);
  assert.match(componentSource, /items\.length === 0 \? <EmptyState icon=\{Activity\} title="暂无运行记录"/);
  assert.match(stylesSource, /\.agent-mux-detail-panel > \.agent-mux-empty-state \{ min-height: 100%; flex: 1; \}/);
});

test('Agent Mux monitor shows profile avatars in run rows and details', () => {
  assert.match(componentSource, /<MonitorView agents=\{agentRecords\}/);
  assert.match(componentSource, /<AgentMuxAvatar avatar=\{run\.avatar\} providerId=\{providerId\} size="small"/);
  assert.match(componentSource, /className="agent-mux-detail-title"[\s\S]*?<AgentMuxAvatar avatar=\{latest\.avatar\} providerId=\{providerId\} size="large"/);
  assert.match(componentSource, /className="conversation agent-mux-conversation-log"/);
  assert.match(componentSource, /<ConversationTurnView/);
});

test('run detail reuses the conversation turn and no empty More menu remains', () => {
  assert.match(componentSource, /buildAgentMuxConversationTurn\(run, events\)/);
  assert.match(componentSource, /<AgentMuxRunLog key=\{item\.id\} run=\{item\}/);
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
  assert.match(stylesSource, /\.agent-mux-run-item > span:not\(\.conversation-agent-avatar\) \{[^}]*flex-direction: column/);
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

test('Agent Mux offers nickname and an internal avatar dropdown with legacy fallback', () => {
  assert.match(componentSource, /nickname: nickname\.trim\(\) \|\| null/);
  assert.match(componentSource, /avatar: avatar \|\| null/);
  assert.match(componentSource, /<AgentMuxAvatarSelect value=\{avatar\}/);
  assert.match(componentSource, /<PopoverPortal open=\{open\} anchorRef=\{anchorRef\}/);
  assert.match(componentSource, /profile\.nickname\?\.trim\(\) \|\| `\$\{profile\.provider\} \/ \$\{profile\.model\}`/);
  assert.match(componentSource, /run\.nickname\?\.trim\(\) \|\| run\.target/);
  assert.match(componentSource, /id === 'codex' \|\| id === 'openai codex'/);
  assert.match(avatarSource, /if \(index === undefined\)[\s\S]*?<AgentProviderIcon providerId=\{providerId\}/);
  assert.doesNotMatch(componentSource, /type="file"/);
});

test('global add profile allows selecting an agent while scoped profile actions stay locked', () => {
  assert.match(componentSource, /setProfileDialog\(\{ agentId: selectedAgent\.id, allowAgentSelection: true \}\)/);
  assert.match(componentSource, /allowAgentSelection \? <StandardSelect ariaLabel="选择 Agent 类型"/);
  assert.match(componentSource, /icon: <AgentProviderIcon providerId=\{agentProviderId\(item\.id\) \?\? item\.id\} size=\{15\} \/>/);
  assert.match(componentSource, /onAddProfile=\{\(\) => setProfileDialog\(\{ agentId: selectedAgent\.id \}\)\}/);
  assert.match(componentSource, /onEditProfile=\{\(profile\) => setProfileDialog\(\{ agentId: selectedAgent\.id, profile \}\)\}/);
});

test('Agent Mux profile configuration selects the channel before its model catalog', () => {
  const dialogSource = componentSource.slice(componentSource.indexOf('function AddRuntimeProfileDialog'));
  const channelField = dialogSource.indexOf('ariaLabel="选择渠道"');
  const modelField = dialogSource.indexOf('ariaLabel="选择模型"');

  assert.ok(channelField >= 0);
  assert.ok(modelField > channelField);
  assert.match(dialogSource, /buildAgentSystemChannelModelCatalog\(providerId, selectedSystemChannel, nativeModelCatalog \?\? null\)/);
  assert.match(dialogSource, /buildAgentChannelModelCatalog\(providerId, selectedAgentChannel, nativeModelCatalog \?\? null\)/);
  assert.match(dialogSource, /channelId === 'system' \? undefined/);
  assert.match(dialogSource, /channelId === 'system' \? <div className="agent-mux-readonly-field">/);
  assert.match(dialogSource, /channel\.ccSwitchProviderName\?\.trim\(\) \|\| providerLabel/);
  assert.match(componentSource, /providerAvailability=\{skillProviderAvailability\}/);
  assert.match(dialogSource, /if \(!providerId \|\| providerAvailability\[providerId\] !== true\)/);
});

test('Agent Mux exposes Hermes as a native JSON-RPC target', () => {
  assert.match(componentSource, /HERMES_AGENT_PROVIDER_ID/);
  assert.match(componentSource, /id === 'hermes' \|\| id === 'hermes agent'/);
  assert.match(cliSource, /const PROVIDER_HERMES: &str = "hermes-agent"/);
  assert.match(cliSource, /"hermes" => Some\(PROVIDER_HERMES\)/);
});

test('Agent Mux skill records the caller agent without requesting a session name', () => {
  assert.match(componentSource, /--caller '<当前主 Agent 名称>'/);
  assert.match(componentSource, /--reasoning-effort '<level>'/);
  assert.match(componentSource, /Grok Build 和 OpenCode 当前不支持/);
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
  assert.match(cliSource, /option\(args, "--reasoning-effort"\)/);
  assert.match(cliSource, /profile\.get\("reasoningEffort"\)/);
  assert.match(cliSource, /"reasoningEffort": reasoning_effort/);
});

test('Agent Mux conversation context only receives explicitly associated runs', () => {
  const runs = [
    { id: 'current', threadId: 'thread-1' },
    { id: 'other', threadId: 'thread-2' },
    { id: 'external', threadId: null },
  ] as AgentMuxRun[];

  assert.deepEqual(filterAgentMuxRunsForThread(runs, 'thread-1').map((run) => run.id), ['current']);
  assert.deepEqual(filterAgentMuxRunsForThread(runs, null), []);
});
