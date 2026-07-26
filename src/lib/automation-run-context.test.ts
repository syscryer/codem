import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const automationHookSource = readFileSync(new URL('../hooks/useAutomations.ts', import.meta.url), 'utf8');
const claudeHookSource = readFileSync(new URL('../hooks/useClaudeRun.ts', import.meta.url), 'utf8');
const agentHookSource = readFileSync(new URL('../hooks/useAgentRun.ts', import.meta.url), 'utf8');

test('automation runs explicitly carry an execution-only marker', () => {
  const markers = automationHookSource.match(/automationExecution: true/g) ?? [];
  assert.equal(markers.length, 2);
});

test('Claude automation marker is sent to the backend without replacing display text', () => {
  assert.match(claudeHookSource, /displayText: prompt/);
  assert.match(claudeHookSource, /automationExecution: options\.automationExecution === true/);
  assert.match(claudeHookSource, /automationExecution: options\?\.automationExecution === true/);
});

test('generic Agent automation marker is sent separately from the visible prompt', () => {
  assert.match(agentHookSource, /displayText: prompt,[\s\S]*automationExecution: options\.automationExecution === true/);
  assert.match(agentHookSource, /automationExecution: submission\.automationExecution === true/);
});
