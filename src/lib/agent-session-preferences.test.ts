import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const agentRunSource = readFileSync(new URL('../hooks/useAgentRun.ts', import.meta.url), 'utf8');
const claudeRunSource = readFileSync(new URL('../hooks/useClaudeRun.ts', import.meta.url), 'utf8');
const workspaceSource = readFileSync(new URL('../hooks/useWorkspaceState.ts', import.meta.url), 'utf8');

test('Claude and generic Agents receive the same configured default permission', () => {
  assert.equal(
    appSource.match(/defaultPermissionMode: general\.defaultPermissionMode/g)?.length,
    2,
  );
  assert.match(
    agentRunSource,
    /const nextPermissionMode = activeThreadSummary[\s\S]*isVisiblePermissionMode\(activeThreadSummary\.permissionMode\)[\s\S]*: defaultPermissionMode/,
  );
  assert.doesNotMatch(agentRunSource, /DEFAULT_AGENT_PERMISSION_MODE/);
});

test('first thread creation persists the selected permission, model, and effort', () => {
  assert.match(claudeRunSource, /permissionMode: permissionModeRef\.current/);
  assert.match(claudeRunSource, /modelRef\.current !== DEFAULT_MODEL_VALUE/);
  assert.match(claudeRunSource, /effortRef\.current !== 'default'/);
  assert.match(agentRunSource, /permissionMode: runPermissionMode/);
  assert.match(agentRunSource, /\.\.\.\(runModel \? \{ model: runModel \} : \{\}\)/);
  assert.match(
    agentRunSource,
    /\.\.\.\(runReasoningEffort \? \{ reasoningEffort: runReasoningEffort \} : \{\}\)/,
  );
});

test('thread metadata failures are observable so selectors can roll back', () => {
  assert.match(workspaceSource, /if \(!response\.ok\) \{/);
  assert.match(workspaceSource, /throw new Error\(message \|\| '保存聊天设置失败'\)/);
  assert.match(claudeRunSource, /setEffortState\(previousEffort\)/);
  assert.match(agentRunSource, /setAgentPermissionMode\(previousMode\)/);
});

test('custom channel model catalogs stay stable while draft model state changes', () => {
  assert.match(agentRunSource, /import \{[^}]*useMemo[^}]*\} from 'react'/);
  assert.match(
    agentRunSource,
    /const currentModelCatalog = useMemo\([\s\S]*buildAgentChannelModelCatalog[\s\S]*\[channelId, nativeModelCatalog, selectedChannel, selectedProviderId\][\s\S]*\);/,
  );
});

test('unsent new-chat runtime selections survive switching through existing threads', () => {
  assert.equal(appSource.match(/isNewChatDraft,/g)?.length, 3);
  assert.match(claudeRunSource, /const draftSelectionRef = useRef<ClaudeDraftSelection>/);
  assert.match(agentRunSource, /const draftSelectionRef = useRef<AgentDraftSelection>/);
  assert.match(
    claudeRunSource,
    /if \(!activeThreadSummary && !isNewChatDraft\) \{\s*return;\s*\}/,
  );
  assert.match(
    agentRunSource,
    /if \(!activeThreadSummary && !isNewChatDraft\) \{\s*return;\s*\}/,
  );
  assert.match(
    claudeRunSource,
    /draftSelectionRef\.current = \{[\s\S]*model: nextModel,[\s\S]*effort: nextEffort/,
  );
  assert.match(
    agentRunSource,
    /draftSelectionRef\.current = \{[\s\S]*model: nextModel,[\s\S]*reasoningEffort: nextEffort/,
  );
  assert.doesNotMatch(
    appSource,
    /function handleCreateThread[\s\S]*?resetDraftProvider\(\)[\s\S]*?enterNewChatDraft/,
  );
  assert.doesNotMatch(agentRunSource, /function resetDraftProvider\(/);
  assert.match(
    claudeRunSource,
    /if \(!isModelSelectionChannelReady\(channelId, targetChannelId\)\) \{\s*return;\s*\}/,
  );
  assert.match(
    agentRunSource,
    /if \(!isModelSelectionChannelReady\(channelId, targetChannelId\)\) \{\s*return;\s*\}/,
  );
});
