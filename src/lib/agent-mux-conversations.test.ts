import test from 'node:test';
import assert from 'node:assert/strict';
import { agentMuxConversationKey, groupAgentMuxRunsByConversation, type AgentMuxRun } from './agent-mux-api';

const run = (id: string, extra: Partial<AgentMuxRun> = {}): AgentMuxRun => ({
  id, caller: 'CodeM', target: 'Codex', profile: 'OpenAI / sol', skill: 'codem-agent-mux',
  status: 'completed', duration: '00:01', started: '刚刚', prompt: id, summary: '',
  threadId: 'thread-1', profileId: 'profile-1', workingDirectory: 'D:/workspace', ...extra,
});

test('groups repeated calls by thread, profile and workspace', () => {
  const groups = groupAgentMuxRunsByConversation([run('a'), run('b'), run('c', { profileId: 'profile-2' })]);
  assert.deepEqual(groups.map((group) => group.map((item) => item.id)), [['a', 'b'], ['c']]);
  assert.equal(agentMuxConversationKey(run('a')), agentMuxConversationKey(run('b')));
});

test('does not merge incomplete or different session keys', () => {
  const groups = groupAgentMuxRunsByConversation([run('a', { threadId: null }), run('b'), run('c', { workingDirectory: 'D:/other' })]);
  assert.deepEqual(groups.map((group) => group.map((item) => item.id)), [['a'], ['b'], ['c']]);
});
