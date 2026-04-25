import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('./claude-service.ts', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');

function extractFunctionBody(functionName: string) {
  const functionMatch = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\*?\\s+${functionName}\\s*\\(`).exec(source);
  const start = functionMatch?.index ?? -1;
  assert.notEqual(start, -1, `${functionName} should exist`);

  const bodyOpenMatch = /\{\r?\n/.exec(source.slice(start));
  const openBrace = bodyOpenMatch ? start + bodyOpenMatch.index : -1;
  assert.notEqual(openBrace, -1, `${functionName} should have a body`);

  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBrace + 1, index);
      }
    }
  }

  assert.fail(`${functionName} body should be closed`);
}

test('continuing a Claude thread reuses a managed runtime before spawning a new one', () => {
  const createClaudeStreamBody = extractFunctionBody('createClaudeStream');
  const getOrCreateClaudeRuntimeBody = extractFunctionBody('getOrCreateClaudeRuntime');
  const isRuntimeCompatibleBody = extractFunctionBody('isRuntimeCompatible');
  const spawnClaudeRuntimeBody = extractFunctionBody('spawnClaudeRuntime');

  assert.match(createClaudeStreamBody, /getOrCreateClaudeRuntime\(command,\s*input\)/);
  assert.match(getOrCreateClaudeRuntimeBody, /threadRuntimes\.get\(key\)/);
  assert.match(getOrCreateClaudeRuntimeBody, /existing\.currentRun[\s\S]*reused:\s*false/);
  assert.match(getOrCreateClaudeRuntimeBody, /isRuntimeCompatible\(existing,\s*input\)/);
  assert.match(getOrCreateClaudeRuntimeBody, /threadRuntimes\.set\(key,\s*runtime\)/);
  assert.match(isRuntimeCompatibleBody, /runtime\.inputMode\s*===\s*['"]stdin['"]/);
  assert.match(isRuntimeCompatibleBody, /runtime\.reusable/);
  assert.match(spawnClaudeRuntimeBody, /inputMode\s*===\s*['"]stdin['"]/);
  assert.match(spawnClaudeRuntimeBody, /\[\s*['"]-p['"],\s*['"]['"],\s*['"]--input-format['"],\s*['"]stream-json['"]\s*\]/);
  assert.match(spawnClaudeRuntimeBody, /if\s*\(\s*resumeSessionId\s*\)\s*{\s*args\.push\(['"]--resume['"],\s*resumeSessionId\)/s);
  assert.match(spawnClaudeRuntimeBody, /spawn\(command,\s*args,\s*{/);
});

test('reusable runtime prompts are sent through stream-json stdin', () => {
  const spawnClaudeRuntimeBody = extractFunctionBody('spawnClaudeRuntime');
  const writePromptToClaudeBody = extractFunctionBody('writePromptToClaude');

  assert.match(spawnClaudeRuntimeBody, /inputMode\s*===\s*['"]stdin['"]/);
  assert.match(spawnClaudeRuntimeBody, /\[\s*['"]-p['"],\s*['"]['"],\s*['"]--input-format['"],\s*['"]stream-json['"]\s*\]/);
  assert.match(spawnClaudeRuntimeBody, /\[\s*['"]-p['"],\s*input\.prompt\s*\]/);
  assert.match(writePromptToClaudeBody, /JSON\.stringify\(buildClaudeInputMessage\(prompt\)\)/);
  assert.match(writePromptToClaudeBody, /runtime\.child\.stdin\.write\(payload,/);
});

test('cold resume starts a stream-json runtime so tool results can be sent while running', () => {
  const getOrCreateClaudeRuntimeBody = extractFunctionBody('getOrCreateClaudeRuntime');
  const writePromptToClaudeBody = extractFunctionBody('writePromptToClaude');

  assert.doesNotMatch(getOrCreateClaudeRuntimeBody, /spawnClaudeRuntime\(command,\s*input,\s*['"]argv['"]\)/);
  assert.match(getOrCreateClaudeRuntimeBody, /spawnClaudeRuntime\(command,\s*input,\s*['"]stdin['"]\)/);
  assert.match(writePromptToClaudeBody, /runtime\.child\.stdin\.write\(payload,/);
});

test('run events are buffered for reconnect instead of being tied to one response', () => {
  const createRunStateBody = extractFunctionBody('createRunState');
  const pushRunEventBody = extractFunctionBody('pushRunEvent');
  const reconnectBody = extractFunctionBody('reconnectClaudeRunEvents');

  assert.match(createRunStateBody, /eventLog:\s*\[\]/);
  assert.match(createRunStateBody, /eventWaiters:\s*new Set/);
  assert.match(pushRunEventBody, /state\.eventLog\.push\(event\)/);
  assert.match(pushRunEventBody, /state\.eventWaiters/);
  assert.match(reconnectBody, /afterEventIndex/);
  assert.match(reconnectBody, /state\.eventLog\.length/);
  assert.match(reconnectBody, /yield state\.eventLog\[index\]/);
});

test('client disconnect detaches a run instead of cancelling the Claude process', () => {
  assert.match(serverSource, /response\.on\(['"]close['"]/);
  assert.match(serverSource, /markRunDetached\(currentRunId\)/);
  assert.match(serverSource, /markThreadRunDetached\(threadId\)/);
  assert.doesNotMatch(serverSource, /response\.on\(['"]close['"][\s\S]{0,160}cancelRun/);
  assert.match(serverSource, /\/api\/claude\/runs\/active\/:threadId/);
  assert.match(serverSource, /\/api\/claude\/run\/:runId\/events/);
});

test('request user input answers are sent back as stream-json tool results', () => {
  const submitBody = extractFunctionBody('submitRunRequestUserInput');
  const buildToolResultBody = extractFunctionBody('buildClaudeToolResultMessage');

  assert.match(serverSource, /\/api\/claude\/run\/:runId\/request-user-input/);
  assert.match(serverSource, /submitRunRequestUserInput\(request\.params\.runId,\s*requestId,\s*answers\)/);
  assert.match(submitBody, /runtime\.inputMode\s*!==\s*['"]stdin['"]/);
  assert.match(submitBody, /runtime\.child\.stdin\.write\(payload,/);
  assert.match(buildToolResultBody, /type:\s*['"]tool_result['"]/);
  assert.match(buildToolResultBody, /tool_use_id:\s*requestId/);
});

test('human input requests pause the run before Claude Code auto-answers the tool call', () => {
  const handleBody = extractFunctionBody('handleClaudePayload');
  const pauseBody = extractFunctionBody('pauseRuntimeRunForHumanInput');
  const parseApprovalBody = extractFunctionBody('parseApprovalRequestEvent');

  assert.match(handleBody, /pauseRuntimeRunForHumanInput\(runtime,\s*state,\s*['"]paused_for_user_input['"]\)/);
  assert.match(handleBody, /pauseRuntimeRunForHumanInput\(runtime,\s*state,\s*['"]paused_for_approval_request['"]\)/);
  assert.match(parseApprovalBody, /normalizedToolName\s*===\s*['"]exitplanmode['"]/);
  assert.match(pauseBody, /enqueueTrace\(state,\s*traceName,\s*Date\.now\(\)\)/);
  assert.match(pauseBody, /type:\s*['"]done['"]/);
  assert.match(pauseBody, /runtime\.child\.kill\(\)/);
  assert.match(pauseBody, /threadRuntimes\.delete\(runtime\.key\)/);
});
