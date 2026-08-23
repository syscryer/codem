import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./pages/TaskDetailPage.tsx', import.meta.url), 'utf8');

test('mobile task detail header displays the agent, conversation title, and project name', () => {
  assert.match(source, /<AgentProviderIcon providerId=\{task\.providerId\} size=\{13\} \/>/);
  assert.match(source, /className="prototype-detail-title-name">\{task\?\.title \|\| 'CodeM'\}<\/span>/);
  assert.match(source, /<span title=\{task\?\.projectName\}>\{task\?\.projectName \|\| '项目'\}<\/span>/);
  assert.doesNotMatch(source, /phaseLabel\(task\?\.phase\).*connectionLabel\(running, thread\.streamState\)/);
});
