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
  assert.match(spawnClaudeRuntimeBody, /['"]--permission-prompt-tool['"][\s\S]*['"]stdio['"]/);
  assert.match(spawnClaudeRuntimeBody, /if\s*\(\s*resumeSessionId\s*\)\s*{\s*args\.push\(['"]--resume['"],\s*resumeSessionId\)/s);
  assert.match(spawnClaudeRuntimeBody, /spawn\(command,\s*args,\s*{/);
});

test('reusable runtime prompts are sent through stream-json stdin', () => {
  const spawnClaudeRuntimeBody = extractFunctionBody('spawnClaudeRuntime');
  const writePromptToClaudeBody = extractFunctionBody('writePromptToClaude');

  assert.match(spawnClaudeRuntimeBody, /inputMode\s*===\s*['"]stdin['"]/);
  assert.match(spawnClaudeRuntimeBody, /\[\s*['"]-p['"],\s*['"]['"],\s*['"]--input-format['"],\s*['"]stream-json['"]\s*\]/);
  assert.match(spawnClaudeRuntimeBody, /\[\s*['"]-p['"],\s*input\.prompt\s*\]/);
  assert.match(writePromptToClaudeBody, /JSON\.stringify\(buildClaudeInputMessage\(input\)\)/);
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
  const bufferedEventBody = extractFunctionBody('createBufferedRunEventForReconnect');

  assert.match(createRunStateBody, /eventLog:\s*\[\]/);
  assert.match(createRunStateBody, /eventWaiters:\s*new Set/);
  assert.match(pushRunEventBody, /createBufferedRunEventForReconnect\(event\)/);
  assert.match(pushRunEventBody, /state\.eventLog\.push\(bufferedEvent\)/);
  assert.match(pushRunEventBody, /state\.eventWaiters/);
  assert.match(reconnectBody, /afterEventIndex/);
  assert.match(reconnectBody, /state\.eventLog\.length/);
  assert.match(reconnectBody, /yield state\.eventLog\[index\]/);
  assert.match(bufferedEventBody, /event\.type === ['"]assistant-snapshot['"]/);
  assert.match(bufferedEventBody, /event\.type === ['"]raw['"]/);
  assert.match(bufferedEventBody, /return null/);
});

test('client disconnect detaches a run instead of cancelling the Claude process', () => {
  assert.match(serverSource, /response\.on\(['"]close['"]/);
  assert.match(serverSource, /markRunDetached\(currentRunId\)/);
  assert.match(serverSource, /markThreadRunDetached\(threadId\)/);
  assert.doesNotMatch(serverSource, /response\.on\(['"]close['"][\s\S]{0,160}cancelRun/);
  assert.match(serverSource, /\/api\/claude\/runs\/active\/:threadId/);
  assert.match(serverSource, /\/api\/claude\/run\/:runId\/events/);
});

test('managed runtime status endpoint reports only CodeM-owned live runtimes', () => {
  const statusBody = extractFunctionBody('getThreadRuntimeStatuses');

  assert.match(source, /export function getThreadRuntimeStatuses/);
  assert.match(statusBody, /threadRuntimes\.entries\(\)/);
  assert.match(statusBody, /isRuntimeProcessAlive\(runtime\)/);
  assert.match(statusBody, /pid:\s*runtime\.child\.pid/);
  assert.match(statusBody, /activeRun:\s*Boolean\(runtime\.currentRun\)/);
  assert.match(serverSource, /getThreadRuntimeStatuses/);
  assert.match(serverSource, /\/api\/claude\/runtimes/);
});

test('request user input answers prefer control responses and keep tool-result fallback', () => {
  const submitBody = extractFunctionBody('submitRunRequestUserInput');
  const buildToolResultBody = extractFunctionBody('buildClaudeToolResultMessage');
  const buildControlResponseBody = extractFunctionBody('buildAskUserQuestionControlResponse');
  const buildRequestUserInputBody = extractFunctionBody('buildRequestUserInputToolResultContent');
  const buildRequestAnswersBody = extractFunctionBody('buildRequestUserInputResponseAnswers');

  assert.match(serverSource, /\/api\/claude\/run\/:runId\/request-user-input/);
  assert.match(serverSource, /submitRunRequestUserInput\(request\.params\.runId,\s*requestId,\s*questions,\s*answers\)/);
  assert.match(submitBody, /runtime\.inputMode\s*!==\s*['"]stdin['"]/);
  assert.match(submitBody, /for \(const \[cReqId, toolUseId\] of activeRun\.state\.controlApprovalToolUseIds\)/);
  assert.match(submitBody, /buildAskUserQuestionControlResponse\(controlRequestId,\s*requestId,\s*questions,\s*answers\)/);
  assert.match(submitBody, /buildClaudeToolResultMessage\(requestId,\s*buildRequestUserInputToolResultContent\(questions,\s*answers\)\)/);
  assert.match(submitBody, /runtime\.child\.stdin\.write\(payload,/);
  assert.match(submitBody, /pausedForUserInput\s*=\s*false/);
  assert.match(buildToolResultBody, /type:\s*['"]tool_result['"]/);
  assert.match(buildToolResultBody, /tool_use_id:\s*requestId/);
  assert.match(buildControlResponseBody, /type:\s*['"]control_response['"]/);
  assert.match(buildControlResponseBody, /updatedInput:/);
  assert.match(buildControlResponseBody, /toolUseID:\s*toolUseId/);
  assert.match(buildRequestUserInputBody, /questions,/);
  assert.match(buildRequestUserInputBody, /answers:\s*buildRequestUserInputResponseAnswers\(questions,\s*answers\)/);
  assert.match(buildRequestAnswersBody, /responseAnswers\[key\]\s*=\s*normalizedAnswer/);
  assert.match(buildRequestAnswersBody, /responseAnswers\[question\.question\]/);
});

test('human input requests pause the run before Claude Code auto-answers the tool call', () => {
  const handleBody = extractFunctionBody('handleClaudePayload');
  const pauseBody = extractFunctionBody('pauseRuntimeRunForHumanInput');
  const parseControlRequestUserInputBody = extractFunctionBody('parseControlRequestUserInputEvent');
  const parseApprovalBody = extractFunctionBody('parseApprovalRequestEvent');
  const submitApprovalBody = extractFunctionBody('submitRunApprovalDecision');
  const writeApprovalBody = extractFunctionBody('writeApprovalDecisionToRuntime');
  const autoApprovalBody = extractFunctionBody('shouldAutoApproveBypassPermissionRequest');
  const controlResponseBody = extractFunctionBody('buildClaudeControlResponseMessage');

  assert.match(handleBody, /payload\.type\s*===\s*['"]control_request['"]/);
  assert.match(handleBody, /parseControlRequestUserInputEvent\(payload\)/);
  assert.match(handleBody, /emitRequestUserInputEvent\(state,\s*runId,\s*requestUserInput,\s*enqueue\)/);
  assert.match(handleBody, /pauseRuntimeRunForHumanInput\(runtime,\s*state,\s*['"]paused_for_user_input['"]\)/);
  assert.match(handleBody, /parseControlApprovalRequestEvent\(payload\)/);
  assert.match(handleBody, /controlApprovalToolUseIds\.set/);
  assert.match(handleBody, /['"]paused_for_approval_request['"]/);
  assert.match(handleBody, /pauseRuntimeRunForHumanInput\(runtime,\s*state,\s*['"]paused_for_approval_result['"],\s*\{\s*closeRuntime:\s*true\s*\}\)/);
  assert.match(handleBody, /isHumanApprovalToolResultContent\(content\)/);
  assert.match(handleBody, /isInternalHumanInputToolResult\(state,\s*block,\s*content\)/);
  assert.match(submitApprovalBody, /writeApprovalDecisionToRuntime\(activeRun\.runtime,\s*activeRun\.state,\s*requestId,\s*decision,\s*content/);
  assert.match(writeApprovalBody, /controlApprovalToolUseIds\.has\(requestId\)/);
  assert.match(writeApprovalBody, /buildClaudeControlResponseMessage\(requestId,\s*decision,\s*controlToolUseId\)/);
  assert.match(autoApprovalBody, /state\.input\.permissionMode\s*===\s*['"]bypassPermissions['"]/);
  assert.match(autoApprovalBody, /request\.kind\s*===\s*['"]permission['"]/);
  assert.match(controlResponseBody, /type:\s*['"]control_response['"]/);
  assert.match(controlResponseBody, /behavior:\s*['"]allow['"]/);
  assert.match(controlResponseBody, /decisionClassification:\s*['"]user_temporary['"]/);
  assert.match(parseControlRequestUserInputBody, /request\.subtype\s*!==\s*['"]can_use_tool['"]/);
  assert.match(parseControlRequestUserInputBody, /parseRequestUserInputEvent\(toolName,\s*request\.input,\s*getControlRequestToolUseId\(payload\)\)/);
  assert.match(source, /function parseControlApprovalRequestEvent/);
  assert.match(source, /function parseControlRequestUserInputEvent/);
  assert.match(source, /function parseRuntimeApprovalRequestEvent/);
  assert.match(source, /normalizeToolName\(toolName\)\s*===\s*['"]exitplanmode['"][\s\S]*return null/);
  assert.match(source, /function emitOrAutoApproveApprovalRequestEvent/);
  assert.match(source, /auto_approved_bypass_permission/);
  assert.match(source, /emittedApprovalRequestKeys/);
  assert.match(parseApprovalBody, /normalizedToolName\s*===\s*['"]exitplanmode['"]/);
  assert.match(parseApprovalBody, /kind:\s*['"]plan-exit['"]/);
  assert.match(pauseBody, /enqueueTrace\(state,\s*traceName,\s*Date\.now\(\)\)/);
  assert.match(pauseBody, /type:\s*['"]done['"]/);
  assert.match(pauseBody, /runtime\.child\.kill\(\)/);
  assert.match(pauseBody, /threadRuntimes\.delete\(runtime\.key\)/);
});
