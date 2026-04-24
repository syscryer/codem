import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('./claude-service.ts', import.meta.url), 'utf8');

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

test('cold resume keeps the legacy argv prompt path instead of starting stdin runtime', () => {
  const getOrCreateClaudeRuntimeBody = extractFunctionBody('getOrCreateClaudeRuntime');
  const writePromptToClaudeBody = extractFunctionBody('writePromptToClaude');

  assert.match(getOrCreateClaudeRuntimeBody, /input\.sessionId\?\.trim\(\)/);
  assert.match(getOrCreateClaudeRuntimeBody, /spawnClaudeRuntime\(command,\s*input,\s*['"]argv['"]\)/);
  assert.match(writePromptToClaudeBody, /runtime\.inputMode\s*===\s*['"]argv['"]/);
  assert.match(writePromptToClaudeBody, /prompt_sent_as_arg/);
  assert.match(writePromptToClaudeBody, /runtime\.child\.stdin\.end\(\)/);
});
