import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const serviceSource = readFileSync(path.join(import.meta.dirname, '../server/lib/claude-service.ts'), 'utf8');
const serverSource = readFileSync(path.join(import.meta.dirname, '../server/index.ts'), 'utf8');

function extractFunctionBody(source: string, functionName: string) {
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

test('Claude Code 运行默认通过 stdin stream-json 交互发送 prompt', () => {
  const createClaudeStreamBody = extractFunctionBody(serviceSource, 'createClaudeStream');
  const getOrCreateRuntimeBody = extractFunctionBody(serviceSource, 'getOrCreateClaudeRuntime');
  const spawnRuntimeBody = extractFunctionBody(serviceSource, 'spawnClaudeRuntime');
  const writePromptBody = extractFunctionBody(serviceSource, 'writePromptToClaude');
  const buildInputMessageBody = extractFunctionBody(serviceSource, 'buildClaudeInputMessage');

  assert.match(createClaudeStreamBody, /getOrCreateClaudeRuntime\(command,\s*input\)/);
  assert.match(createClaudeStreamBody, /writePromptToClaude\(runtime,\s*state,\s*input\)/);
  assert.match(getOrCreateRuntimeBody, /spawnClaudeRuntime\(command,\s*input,\s*['"]stdin['"]\)/);
  assert.doesNotMatch(getOrCreateRuntimeBody, /spawnClaudeRuntime\(command,\s*input,\s*['"]argv['"]\)/);

  assert.match(
    spawnRuntimeBody,
    /\[\s*['"]-p['"],\s*['"]['"],\s*['"]--input-format['"],\s*['"]stream-json['"]\s*\]/,
  );
  assert.match(spawnRuntimeBody, /args\.push\(['"]--verbose['"],\s*['"]--output-format['"],\s*['"]stream-json['"]/);
  assert.match(spawnRuntimeBody, /args\.push\([^)]*['"]--include-partial-messages['"]/);
  assert.match(writePromptBody, /runtime\.child\.stdin\.write\(payload,/);
  assert.match(writePromptBody, /JSON\.stringify\(buildClaudeInputMessage\(input\)\)/);
  assert.match(buildInputMessageBody, /type:\s*['"]user['"]/);
  assert.match(buildInputMessageBody, /role:\s*['"]user['"]/);
  assert.match(buildInputMessageBody, /text:\s*input\.prompt/);
});

test('交互运行中的人工决策会回写到同一个 Claude Code 会话', () => {
  const submitRequestUserInputBody = extractFunctionBody(serviceSource, 'submitRunRequestUserInput');
  const submitApprovalDecisionBody = extractFunctionBody(serviceSource, 'submitRunApprovalDecision');
  const buildToolResultMessageBody = extractFunctionBody(serviceSource, 'buildClaudeToolResultMessage');

  assert.match(serverSource, /\/api\/claude\/run\/:runId\/request-user-input/);
  assert.match(serverSource, /\/api\/claude\/run\/:runId\/approval-decision/);

  assert.match(submitRequestUserInputBody, /runtime\.inputMode\s*!==\s*['"]stdin['"]/);
  assert.match(submitRequestUserInputBody, /runtime\.child\.stdin\.write\(payload,/);
  assert.match(submitRequestUserInputBody, /pausedForUserInput\s*=\s*false/);
  assert.match(submitRequestUserInputBody, /stdin_tool_result_written/);

  assert.match(submitApprovalDecisionBody, /runtime\.inputMode\s*!==\s*['"]stdin['"]/);
  assert.match(submitApprovalDecisionBody, /runtime\.child\.stdin\.write\(payload,/);
  assert.match(submitApprovalDecisionBody, /pausedForUserInput\s*=\s*false/);
  assert.match(submitApprovalDecisionBody, /stdin_approval_result_written/);

  assert.match(buildToolResultMessageBody, /type:\s*['"]tool_result['"]/);
  assert.match(buildToolResultMessageBody, /tool_use_id:\s*requestId/);
});
