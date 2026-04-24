import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('./claude-service.ts', import.meta.url), 'utf8');

function extractFunctionBody(functionName: string) {
  const functionMatch = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\*?\\s+${functionName}\\s*\\(`).exec(source);
  const start = functionMatch?.index ?? -1;
  assert.notEqual(start, -1, `${functionName} should exist`);

  const openBrace = source.indexOf('{', start);
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

test('continuing a Claude session starts a new CLI process and resumes by session id', () => {
  const createClaudeStreamBody = extractFunctionBody('createClaudeStream');
  const spawnClaudeRuntimeBody = extractFunctionBody('spawnClaudeRuntime');

  assert.match(createClaudeStreamBody, /spawnClaudeRuntime\(command,\s*input\)/);
  assert.match(spawnClaudeRuntimeBody, /const\s+args\s*=\s*\[\s*['"]-p['"]\s*\]/);
  assert.match(spawnClaudeRuntimeBody, /if\s*\(\s*resumeSessionId\s*\)\s*{\s*args\.push\(['"]--resume['"],\s*resumeSessionId\)/s);
  assert.match(spawnClaudeRuntimeBody, /spawn\(command,\s*args,\s*{/);
});

test('multiline prompts use stream-json stdin instead of passing the prompt as argv', () => {
  const spawnClaudeRuntimeBody = extractFunctionBody('spawnClaudeRuntime');
  const shouldUseStreamJsonInputBody = extractFunctionBody('shouldUseStreamJsonInput');
  const writePromptToClaudeBody = extractFunctionBody('writePromptToClaude');

  assert.match(spawnClaudeRuntimeBody, /const\s+useStreamJsonInput\s*=\s*shouldUseStreamJsonInput\(input\.prompt\)/);
  assert.match(spawnClaudeRuntimeBody, /args\.push\(['"]['"],\s*['"]--input-format['"],\s*['"]stream-json['"]\)/);
  assert.match(spawnClaudeRuntimeBody, /args\.push\(input\.prompt\)/);
  assert.match(shouldUseStreamJsonInputBody, /prompt\.includes\(['"]\\n['"]\)/);
  assert.match(writePromptToClaudeBody, /JSON\.stringify\(buildClaudeInputMessage\(prompt\)\)/);
  assert.match(writePromptToClaudeBody, /runtime\.child\.stdin\.write\(payload,/);
});
