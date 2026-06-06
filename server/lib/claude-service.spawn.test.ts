import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ClaudeService from './claude-service.js';
import {
  buildClaudeCommandLookupInvocation,
  buildClaudeInputMessage,
  summarizeClaudeInputForHistory,
  summarizeClaudeInputForTrace,
} from './claude-service.js';

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

  assert.match(createClaudeStreamBody, /getOrCreateClaudeRuntime\(command,\s*runtimeInput\)/);
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
  assert.match(
    spawnClaudeRuntimeBody,
    /spawn\(resolveClaudeSpawnCommand\(command\),\s*resolveClaudeSpawnArgs\(command,\s*args\),\s*\{/,
  );
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

test('Claude adapter consumes shared neutral block types and helpers', () => {
  assert.match(source, /import type\s*\{\s*InputContentBlock[\s\S]*\}\s*from ['"]\.\.\/\.\.\/src\/types\.js['"]/);
  assert.match(source, /normalizeInputContentBlocks/);
  assert.match(source, /stripTransientInputBlockData/);
  assert.match(source, /summarizeInputContentBlocksForTrace/);
  assert.doesNotMatch(source, /type NeutralInputContentBlock\s*=/);
  assert.doesNotMatch(source, /function summarizeNeutralInputContentBlocksForTrace/);
  assert.doesNotMatch(source, /function normalizeProvidedNeutralInputContentBlocks/);

  const normalizeBody = extractFunctionBody('normalizeStreamInputContentBlocks');
  assert.match(normalizeBody, /normalizeInputContentBlocks\(\{/);
  assert.match(normalizeBody, /prompt:\s*input\.prompt/);
  assert.match(normalizeBody, /contentBlocks:\s*input\.contentBlocks/);
  assert.match(normalizeBody, /imageAttachments:/);
});

test('Claude input message includes image content blocks after text', () => {
  const message = buildClaudeInputMessage({
    threadId: 'thread-a',
    turnId: 'turn-a',
    prompt: '请看这张图',
    workingDirectory: 'D:\\workspace',
    permissionMode: 'default',
    imageAttachments: [
      {
        mimeType: 'image/png',
        data: 'iVBORw0KGgo=',
      },
    ],
  });

  assert.deepEqual(message.message.content, [
    {
      type: 'text',
      text: '请看这张图',
    },
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'iVBORw0KGgo=',
      },
    },
  ]);
});

test('Claude input message maps neutral blocks into Claude stdin content', () => {
  const message = buildClaudeInputMessage({
    threadId: 'thread-a',
    turnId: 'turn-a',
    prompt: 'legacy prompt should be ignored',
    workingDirectory: 'D:\\workspace',
    permissionMode: 'default',
    contentBlocks: [
      {
        type: 'text',
        text: '  请结合这些输入继续  ',
      },
      {
        type: 'image',
        mimeType: 'image/png',
        data: 'iVBORw0KGgo=',
      },
      {
        type: 'file_reference',
        path: 'D:\\workspace\\src\\App.tsx',
        name: 'App.tsx',
        reason: 'too_large',
      },
      {
        type: 'file_text',
        path: 'D:\\workspace\\notes\\todo.md',
        name: 'todo.md',
        text: 'console.log("hi")',
      },
      {
        type: 'attachment_metadata',
        name: 'archive.zip',
        reason: 'binary',
      },
    ],
  } as Parameters<typeof buildClaudeInputMessage>[0]);

  assert.deepEqual(message.message.content, [
    {
      type: 'text',
      text: '请结合这些输入继续',
    },
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'iVBORw0KGgo=',
      },
    },
    {
      type: 'text',
      text: '文件已作为路径引用提供：D:/workspace/src/App.tsx\n原因：too_large\n可使用 Read 等工具按需读取该文件内容。',
    },
    {
      type: 'text',
      text: '文件 D:/workspace/notes/todo.md 内容：\n\nconsole.log("hi")',
    },
    {
      type: 'text',
      text: '附件未直接发送：archive.zip\n原因：binary',
    },
  ]);
});

test('invalid direct content blocks still fall back to legacy prompt and image attachments', () => {
  const message = buildClaudeInputMessage({
    threadId: 'thread-a',
    turnId: 'turn-a',
    prompt: '  回退到 legacy  ',
    workingDirectory: 'D:\\workspace',
    permissionMode: 'default',
    contentBlocks: [
      {
        type: 'text',
        text: '   ',
      },
    ],
    imageAttachments: [
      {
        mimeType: 'image/png',
        data: 'iVBORw0KGgo=',
      },
    ],
  } as Parameters<typeof buildClaudeInputMessage>[0]);

  assert.deepEqual(message.message.content, [
    {
      type: 'text',
      text: '回退到 legacy',
    },
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'iVBORw0KGgo=',
      },
    },
  ]);
});

test('mixed direct and legacy inputs preserve legacy text and images when some direct blocks are dropped', () => {
  const input = {
    threadId: 'thread-a',
    turnId: 'turn-a',
    prompt: '  legacy text  ',
    workingDirectory: 'D:\\workspace',
    permissionMode: 'default',
    contentBlocks: [
      {
        type: 'text',
        text: 'direct text',
      },
      {
        type: 'text',
        text: '   ',
      },
    ],
    imageAttachments: [
      {
        mimeType: 'image/png',
        data: 'iVBORw0KGgo=',
      },
    ],
  } as Parameters<typeof buildClaudeInputMessage>[0];

  const message = buildClaudeInputMessage(input);

  assert.deepEqual(message.message.content, [
    {
      type: 'text',
      text: 'direct text',
    },
    {
      type: 'text',
      text: 'legacy text',
    },
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'iVBORw0KGgo=',
      },
    },
  ]);

  const summary = summarizeClaudeInputForTrace(input);
  assert.equal(summary, 'text=2, images=1, fileText=0, fileReferences=0, metadata=0, imageBytes=8');
});

test('Claude input trace summarizes image blocks without exposing base64 data', () => {
  const summary = summarizeClaudeInputForTrace({
    prompt: '请看这张图',
    imageAttachments: [
      {
        mimeType: 'image/png',
        data: 'SGVsbG8=',
      },
    ],
  });

  assert.equal(summary, 'text=1, images=1, fileText=0, fileReferences=0, metadata=0, imageBytes=5');
  assert.doesNotMatch(summary, /SGVsbG8=/);

  const writePromptToClaudeBody = extractFunctionBody('writePromptToClaude');
  assert.match(writePromptToClaudeBody, /summarizeClaudeInputForTrace\(input\)/);
});

test('Claude input trace summarizes neutral blocks without exposing content', () => {
  const summary = summarizeClaudeInputForTrace({
    prompt: 'legacy prompt should be ignored',
    contentBlocks: [
      {
        type: 'text',
        text: '不要泄露这段文本',
      },
      {
        type: 'image',
        mimeType: 'image/png',
        data: 'SGVsbG8=',
      },
      {
        type: 'file_text',
        path: 'D:\\workspace\\notes\\todo.md',
        name: 'todo.md',
        text: '不要泄露这个文件内容',
      },
      {
        type: 'file_reference',
        path: 'D:\\workspace\\src\\App.tsx',
        name: 'App.tsx',
      },
      {
        type: 'attachment_metadata',
        name: 'archive.zip',
        reason: 'binary',
      },
    ],
  } as Parameters<typeof summarizeClaudeInputForTrace>[0]);

  assert.equal(summary, 'text=1, images=1, fileText=1, fileReferences=1, metadata=1, imageBytes=5');
  assert.doesNotMatch(summary, /不要泄露这段文本/);
  assert.doesNotMatch(summary, /不要泄露这个文件内容/);
  assert.doesNotMatch(summary, /SGVsbG8=/);
});

test('image content blocks with a local path append a ViewImage fallback text for non-multimodal models', () => {
  const input = {
    contentBlocks: [
      {
        type: 'image',
        id: 'image-1',
        path: 'D:\\workspace\\.codem-attachments\\pasted-1.png',
        name: 'pasted-1.png',
        mimeType: 'image/png',
        size: 8,
        data: 'iVBORw0KGgo=',
      },
    ],
  } as Parameters<typeof buildClaudeInputMessage>[0];

  const message = buildClaudeInputMessage(input);

  assert.equal(message.message.content.length, 2);
  assert.deepEqual(message.message.content[0], {
    type: 'image',
    source: {
      type: 'base64',
      media_type: 'image/png',
      data: 'iVBORw0KGgo=',
    },
  });

  const fallback = message.message.content[1] as { type: 'text'; text: string };
  assert.equal(fallback.type, 'text');
  assert.match(fallback.text, /D:\/workspace\/\.codem-attachments\/pasted-1\.png/);
  assert.match(fallback.text, /ViewImage/);
  assert.doesNotMatch(fallback.text, /iVBORw0KGgo=/);
});

test('image content blocks without a local path do not append fallback text', () => {
  const input = {
    contentBlocks: [
      {
        type: 'image',
        mimeType: 'image/png',
        data: 'iVBORw0KGgo=',
      },
    ],
  } as Parameters<typeof buildClaudeInputMessage>[0];

  const message = buildClaudeInputMessage(input);

  assert.equal(message.message.content.length, 1);
  assert.deepEqual(message.message.content[0], {
    type: 'image',
    source: {
      type: 'base64',
      media_type: 'image/png',
      data: 'iVBORw0KGgo=',
    },
  });
});

test('trace summary uses content block summary instead of raw prompt details', () => {
  const body = extractFunctionBody('summarizeClaudeInputForTrace');
  assert.match(body, /summarizeInputContentBlocksForTrace/);
  assert.doesNotMatch(body, /input\.prompt\.length/);
});

test('history summary strips transient content block payloads for active run reconnect', () => {
  const summary = summarizeClaudeInputForHistory({
    prompt: 'legacy prompt',
    contentBlocks: [
      {
        type: 'text',
        text: '  请结合附件继续  ',
      },
      {
        type: 'image',
        path: 'D:\\workspace\\.codem-attachments\\image.png',
        name: 'image.png',
        mimeType: 'image/png',
        size: 5,
        data: 'SGVsbG8=',
      },
      {
        type: 'file_text',
        path: 'D:\\workspace\\src\\note.ts',
        name: 'note.ts',
        text: 'console.log("secret")',
      },
    ],
  } as Parameters<typeof summarizeClaudeInputForHistory>[0]);

  assert.deepEqual(summary, [
    {
      type: 'text',
      text: '请结合附件继续',
    },
    {
      type: 'image',
      path: 'D:\\workspace\\.codem-attachments\\image.png',
      name: 'image.png',
      mimeType: 'image/png',
      size: 5,
      imageBytes: 5,
    },
    {
      type: 'file_text',
      path: 'D:\\workspace\\src\\note.ts',
      name: 'note.ts',
      textBytes: 21,
    },
  ]);
});

test('guide prompts keep the 4-argument compatibility signature and still isolate guide content blocks', () => {
  const submitGuideBody = extractFunctionBody('submitRunGuidePrompt');

  assert.match(
    source,
    /export function submitRunGuidePrompt\(\s*runId: string,\s*prompt: string,\s*imageAttachments: ClaudeInputImageAttachment\[\] = \[\],\s*guideContentBlocks: InputContentBlock\[\] = \[\],\s*\)/,
  );
  assert.match(submitGuideBody, /if \(!trimmedPrompt && guideContentBlocks\.length === 0\) \{/);
  assert.match(submitGuideBody, /contentBlocks:\s*guideContentBlocks,/);
  assert.doesNotMatch(submitGuideBody, /\.\.\.activeRun\.state\.input/);
  assert.match(serverSource, /guideImageAttachments\s*=\s*normalizeClaudeRunImageAttachments\(request\.body\?\.attachments\)/);
  assert.match(serverSource, /guideContentBlocks\s*=\s*normalizeClaudeRunContentBlocks\(\{/);
  assert.match(
    serverSource,
    /submitRunGuidePrompt\(request\.params\.runId,\s*prompt,\s*guideImageAttachments,\s*guideContentBlocks\)/,
  );
});

test('Claude effort is parsed, passed to the CLI, and included in runtime compatibility', () => {
  const isRuntimeCompatibleBody = extractFunctionBody('isRuntimeCompatible');
  const spawnClaudeRuntimeBody = extractFunctionBody('spawnClaudeRuntime');

  assert.match(serverSource, /const effort\s*=[\s\S]*request\.body\?\.effort/);
  assert.match(serverSource, /effort,/);
  assert.match(source, /effort\?:\s*ClaudeEffortLevel/);
  assert.match(isRuntimeCompatibleBody, /runtime\.effort\s*===\s*input\.effort/);
  assert.match(spawnClaudeRuntimeBody, /args\.push\(['"]--effort['"],\s*input\.effort\)/);
  assert.match(spawnClaudeRuntimeBody, /effort:\s*input\.effort/);
});

test('managed runtime compatibility includes the Claude provider fingerprint', () => {
  const isRuntimeCompatibleBody = extractFunctionBody('isRuntimeCompatible');
  const spawnClaudeRuntimeBody = extractFunctionBody('spawnClaudeRuntime');
  const createClaudeStreamBody = extractFunctionBody('createClaudeStream');

  assert.match(source, /providerFingerprint\?:\s*string/);
  assert.match(source, /getClaudeProviderSnapshot/);
  assert.match(createClaudeStreamBody, /providerFingerprint:\s*providerSnapshot\.fingerprint/);
  assert.match(isRuntimeCompatibleBody, /runtime\.providerFingerprint\s*===\s*input\.providerFingerprint/);
  assert.match(spawnClaudeRuntimeBody, /providerFingerprint:\s*input\.providerFingerprint/);
});

test('Windows Claude command resolution prefers spawnable executables over npm shell shims', () => {
  const resolveBody = extractFunctionBody('resolveClaudeCommand');
  const selectBody = extractFunctionBody('selectSpawnableClaudeCommand');

  assert.match(resolveBody, /selectSpawnableClaudeCommand\(candidates\)/);
  assert.match(selectBody, /process\.platform !== ['"]win32['"]/);
  assert.match(selectBody, /new Set\(\[['"]\.exe['"], ['"]\.cmd['"], ['"]\.bat['"], ['"]\.com['"]\]\)/);
  assert.match(selectBody, /candidates\.find/);
  assert.match(selectBody, /preferredCandidate \?\? candidates\[0\] \?\? null/);
});

test('Windows Claude cmd shims are spawned through cmd.exe with wrapped args', () => {
  const spawnClaudeRuntimeBody = extractFunctionBody('spawnClaudeRuntime');
  const resolveCommandBody = extractFunctionBody('resolveClaudeSpawnCommand');
  const resolveArgsBody = extractFunctionBody('resolveClaudeSpawnArgs');

  assert.match(spawnClaudeRuntimeBody, /spawn\(resolveClaudeSpawnCommand\(command\),\s*resolveClaudeSpawnArgs\(command,\s*args\),\s*\{/);
  assert.match(spawnClaudeRuntimeBody, /shell:\s*false/);
  assert.match(resolveCommandBody, /process\.platform === ['"]win32['"]/);
  assert.match(resolveCommandBody, /cmd\.exe/);
  assert.match(resolveArgsBody, /\/\\\.\(cmd\|bat\)\$\/i/);
  assert.match(resolveArgsBody, /['"]\/d['"],\s*['"]\/s['"],\s*['"]\/c['"],\s*command,\s*\.\.\.args/);
});

test('Windows Claude lookup uses PowerShell with UTF-8 output so Chinese user directories are preserved', () => {
  const lookup = buildClaudeCommandLookupInvocation('win32');

  assert.equal(lookup.command, 'powershell.exe');
  assert.deepEqual(lookup.args.slice(0, 3), ['-NoProfile', '-ExecutionPolicy', 'Bypass']);
  assert.match(lookup.args.at(-1) ?? '', /\[Console\]::OutputEncoding\s*=\s*\[System\.Text\.Encoding\]::UTF8/);
  assert.match(lookup.args.at(-1) ?? '', /\$OutputEncoding\s*=\s*\[System\.Text\.Encoding\]::UTF8/);
  assert.match(lookup.args.at(-1) ?? '', /Get-Command claude/);
});

test('Claude version check wraps Windows cmd shims the same way as runtime spawning', () => {
  const versionInfoBody = extractFunctionBody('getClaudeCliVersionInfo');

  assert.match(versionInfoBody, /spawnSync\(resolveClaudeSpawnCommand\(command\),\s*resolveClaudeSpawnArgs\(command,\s*\[['"]--version['"]\]\)/);
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
  const pushReconnectBody = extractFunctionBody('pushReconnectBufferedEvent');
  const reconnectBody = extractFunctionBody('reconnectClaudeRunEvents');
  const bufferedEventBody = extractFunctionBody('createBufferedRunEventForReconnect');

  assert.match(createRunStateBody, /eventLog:\s*\[\]/);
  assert.match(createRunStateBody, /eventWaiters:\s*new Set/);
  assert.match(pushRunEventBody, /pushReconnectBufferedEvent\(state\.eventLog,\s*event\)/);
  assert.match(pushReconnectBody, /createBufferedRunEventForReconnect\(event\)/);
  assert.match(pushReconnectBody, /eventLog\.splice\(0,\s*overflow\)/);
  assert.match(pushRunEventBody, /state\.eventWaiters/);
  assert.match(reconnectBody, /afterEventIndex/);
  assert.match(reconnectBody, /state\.eventLog\.length/);
  assert.match(reconnectBody, /yield state\.eventLog\[index\]/);
  assert.match(bufferedEventBody, /event\.type === ['"]assistant-snapshot['"]/);
  assert.match(bufferedEventBody, /event\.type === ['"]raw['"]/);
  assert.match(bufferedEventBody, /return null/);
});

test('reconnect event buffering keeps only the most recent bounded events', () => {
  const pushReconnectBufferedEvent = (
    ClaudeService as {
      pushReconnectBufferedEvent?: (eventLog: unknown[], event: unknown, maxEvents?: number) => void;
    }
  ).pushReconnectBufferedEvent;

  if (typeof pushReconnectBufferedEvent !== 'function') {
    assert.fail('pushReconnectBufferedEvent should be exported');
  }

  const eventLog: unknown[] = [];
  for (let index = 0; index < 5; index += 1) {
    pushReconnectBufferedEvent(
      eventLog,
      {
        type: 'phase',
        runId: 'run-a',
        phase: 'computing',
        label: `phase-${index}`,
      },
      3,
    );
  }

  assert.deepEqual(
    eventLog.map((event) => (event as { label?: string }).label),
    ['phase-2', 'phase-3', 'phase-4'],
  );
});

test('runtime stream buffers are bounded while retaining the newest text', () => {
  const appendBoundedRuntimeBuffer = (
    ClaudeService as {
      appendBoundedRuntimeBuffer?: (buffer: string, chunk: string, maxChars?: number) => string;
    }
  ).appendBoundedRuntimeBuffer;

  if (typeof appendBoundedRuntimeBuffer !== 'function') {
    assert.fail('appendBoundedRuntimeBuffer should be exported');
  }

  const next = appendBoundedRuntimeBuffer('prefix-', 'x'.repeat(128), 32);

  assert.equal(next.length, 32);
  assert.match(next, /\[已截断\]/);
  assert.ok(next.endsWith('x'.repeat(12)));
});

test('Claude retry progress from stderr is surfaced as a running phase update', () => {
  const stderrBody = extractFunctionBody('flushRuntimeStderrLine');
  const bindRuntimeBody = extractFunctionBody('bindClaudeRuntime');

  assert.match(source, /parseClaudeRetryStatus/);
  assert.match(source, /splitClaudeStderrBuffer/);
  assert.match(bindRuntimeBody, /splitClaudeStderrBuffer\(stderrBuffer\)/);
  assert.match(bindRuntimeBody, /appendBoundedRuntimeBuffer\(['"]{2},\s*rest\)/);
  assert.match(bindRuntimeBody, /parseClaudeRetryStatus\(runtime\.stderrBuffer\)/);
  assert.match(stderrBody, /parseClaudeRetryStatus\(trimmed\)/);
  assert.match(stderrBody, /type:\s*['"]phase['"]/);
  assert.match(stderrBody, /phase:\s*['"]requesting['"]/);
  assert.match(stderrBody, /label:\s*retryStatus\.message/);
});

test('Claude stream api_retry events are surfaced as retry phase updates', () => {
  const handleBody = extractFunctionBody('handleClaudePayload');

  assert.match(handleBody, /payload\.subtype === ['"]api_retry['"]/);
  assert.match(handleBody, /parseClaudeApiRetryStatus\(payload\)/);
  assert.match(handleBody, /type:\s*['"]phase['"]/);
  assert.match(handleBody, /phase:\s*['"]requesting['"]/);
  assert.match(handleBody, /label:\s*retryStatus\.message/);
});

test('sidechain token usage and result events do not update the parent run', () => {
  const handleBody = extractFunctionBody('handleClaudePayload');

  assert.match(handleBody, /const isSidechain = Boolean\(payload\.isSidechain\)/);
  assert.match(
    handleBody,
    /if\s*\(\s*payload\.type !== ['"]result['"] && !isSidechain\s*\)\s*\{\s*const usage = extractUsage\(payload\);/,
  );
  assert.match(handleBody, /if\s*\(\s*payload\.type === ['"]result['"] && !isSidechain\s*\)\s*\{/);
});

test('client disconnect detaches a run instead of cancelling the Claude process', () => {
  assert.match(serverSource, /response\.on\(['"]close['"]/);
  assert.match(serverSource, /markRunDetached\(currentRunId\)/);
  assert.match(serverSource, /markThreadRunDetached\(threadId\)/);
  assert.doesNotMatch(serverSource, /response\.on\(['"]close['"][\s\S]{0,160}cancelRun/);
  assert.match(serverSource, /\/api\/claude\/runs\/active\/:threadId/);
  assert.match(serverSource, /\/api\/claude\/run\/:runId\/events/);
});

test('active run status reports an inactive payload without a not-found response', () => {
  const routeMatch = serverSource.match(/app\.get\('\/api\/claude\/runs\/active\/:threadId'[\s\S]*?\n}\);/);
  assert.ok(routeMatch, 'active run route should exist');

  const routeBody = routeMatch[0];
  assert.match(routeBody, /response\.json\(\{\s*active:\s*false\s*\}\)/);
  assert.doesNotMatch(routeBody, /response\.status\(404\)/);
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

test('runtime context requests use a dedicated stream-json side channel', () => {
  const requestBody = extractFunctionBody('requestThreadRuntimeContext');
  const stdoutBody = extractFunctionBody('flushRuntimeStdoutLine');
  const getRuntimeBody = extractFunctionBody('getOrCreateClaudeRuntime');
  const createStreamBody = extractFunctionBody('createClaudeStream');

  assert.match(source, /contextRequest\?:\s*ClaudeContextRequest/);
  assert.match(requestBody, /threadRuntimes\.get\(normalizedThreadId\)/);
  assert.match(requestBody, /runtime\.child\.stdin\.write\(payload,/);
  assert.match(requestBody, /buildClaudeContextRequestMessage\(runtime\.key\)/);
  assert.match(stdoutBody, /if\s*\(runtime\.contextRequest\)\s*{/);
  assert.match(stdoutBody, /handleRuntimeContextStdoutLine\(runtime,\s*runtime\.contextRequest,\s*line\)/);
  assert.match(stdoutBody, /const state = runtime\.currentRun/);
  assert.match(getRuntimeBody, /existing\.contextRequest/);
  assert.match(createStreamBody, /runtime\.contextRequest/);
  assert.match(serverSource, /requestThreadRuntimeContext/);
  assert.match(serverSource, /\/api\/claude\/runtime\/:threadId\/context/);
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
