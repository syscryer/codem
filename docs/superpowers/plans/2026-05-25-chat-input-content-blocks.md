# Chat Input Content Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement CodeM's lightweight first-stage chat input blocks: protocol-neutral input model, Claude adapter normalization, image fallback, small text/code attachments, and basic `@文件` references.

**Architecture:** Composer and runtime code produce CodeM-owned `InputContentBlock[]`; backend endpoints normalize legacy `prompt + attachments` and new `contentBlocks` into that model; only the Claude adapter converts blocks into Claude stdin content. First stage deliberately excludes PDF/DOCX parsing, complex drag-drop, cross-window file tree drops, and full attachment manager UI.

**Tech Stack:** React + TypeScript frontend, Node/Express backend, Node built-in test runner with `tsx`, existing Claude `stream-json` bridge.

---

## Scope Guard

This plan implements only the confirmed lightweight first stage.

Do:

- Keep `/api/claude/run` compatible with old `prompt + attachments`.
- Add provider-neutral `InputContentBlock` helpers.
- Preserve image multimodal blocks and `ViewImage` fallback.
- Add small text/code upload and basic `@文件` references.
- Store only safe summaries in history, queue previews, guide requests, and trace output.

Do not:

- Implement PDF document blocks.
- Implement DOCX extraction.
- Implement long paste to file attachment.
- Implement cross-window drag-drop, high-DPI drag coordinates, or full file tree drag bridge.
- Rewrite Composer around another full ChatInputBox architecture.
- Commit changes automatically. Project rule: no git commit unless the user explicitly asks.

## File Map

Create:

- `src/lib/input-content-blocks.ts`: provider-neutral block types, normalization, trace summary, safe persistence projection.
- `src/lib/input-content-blocks.test.ts`: unit tests for normalization, summary, and transient data stripping.
- `src/lib/composer-input-files.ts`: browser-side file classification for image and small text/code uploads.
- `src/lib/composer-input-files.test.ts`: unit tests for supported file types, size limits, and path/file naming helpers.
- `src/lib/file-reference-paths.ts`: shared path parsing, Windows normalization, duplicate detection, and `@path` extraction.
- `src/lib/file-reference-paths.test.ts`: unit tests for `@文件` parsing and Windows path dedupe.

Modify:

- `src/types.ts`: add `InputContentBlock`, `InputContentBlockSummary`, and generalize user attachments without breaking existing image display.
- `src/lib/claude-run-attachments.ts`: either wrap or replace image-only helpers with block-aware helpers.
- `src/lib/claude-run-attachments.test.ts`: update tests for block-aware request attachments and safe history projection.
- `src/lib/composer-attachments.ts`: keep image fallback text generation, make it consume image blocks or image paths.
- `tests/composer-attachments.test.ts`: keep existing `ViewImage` fallback tests green.
- `src/components/Composer.tsx`: support image and small text/code pending attachments, plus basic `@文件` insertion.
- `src/components/ConversationTurn.tsx`: render image thumbnails and non-image file chips from safe attachment summaries.
- `src/hooks/useClaudeRun.ts`: carry `contentBlocks` through direct send, queue, guide, retry/restore-safe turn state.
- `server/index.ts`: accept `contentBlocks` on run and guide endpoints; add lightweight file search and generic small text/image attachment upload where needed.
- `server/lib/claude-service.ts`: convert normalized blocks to Claude stdin content blocks and summarize trace without leaking content.
- `server/lib/claude-service.spawn.test.ts`: add static and behavioral coverage for block adapter and trace summaries.
- `server/lib/workspace-store.ts`: persist safe block/attachment summaries, never base64 or full large file content.

Do not modify:

- Desktop/Tauri shell code.
- Build scripts.
- Provider implementations other than Claude adapter.

## Task 1: Provider-Neutral Block Model

**Files:**

- Create: `src/lib/input-content-blocks.ts`
- Create: `src/lib/input-content-blocks.test.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Write failing tests for block normalization**

Create `src/lib/input-content-blocks.test.ts` with:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeInputContentBlocks,
  stripTransientInputBlockData,
  summarizeInputContentBlocksForTrace,
} from './input-content-blocks.js';

test('normalizeInputContentBlocks converts legacy prompt and image attachments into neutral blocks', () => {
  const blocks = normalizeInputContentBlocks({
    prompt: '请看这张图',
    imageAttachments: [
      {
        id: 'image-1',
        path: 'D:\\workspace\\.codem-attachments\\a.png',
        name: 'a.png',
        mimeType: 'image/png',
        size: 5,
        data: 'SGVsbG8=',
      },
    ],
  });

  assert.deepEqual(blocks, [
    { type: 'text', text: '请看这张图' },
    {
      type: 'image',
      id: 'image-1',
      path: 'D:\\workspace\\.codem-attachments\\a.png',
      name: 'a.png',
      mimeType: 'image/png',
      size: 5,
      data: 'SGVsbG8=',
    },
  ]);
});

test('normalizeInputContentBlocks accepts only attachment messages without inventing display text', () => {
  const blocks = normalizeInputContentBlocks({
    prompt: '',
    imageAttachments: [
      {
        id: 'image-1',
        path: 'D:\\workspace\\.codem-attachments\\a.png',
        name: 'a.png',
        mimeType: 'image/png',
        data: 'SGVsbG8=',
      },
    ],
  });

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.type, 'image');
});

test('stripTransientInputBlockData removes base64 and inline text from persisted summaries', () => {
  const stripped = stripTransientInputBlockData([
    { type: 'text', text: '请看' },
    {
      type: 'image',
      id: 'image-1',
      path: 'D:\\workspace\\.codem-attachments\\a.png',
      name: 'a.png',
      mimeType: 'image/png',
      size: 5,
      data: 'SGVsbG8=',
    },
    {
      type: 'file_text',
      id: 'file-1',
      path: 'D:\\workspace\\src\\a.ts',
      name: 'a.ts',
      mimeType: 'text/typescript',
      size: 12,
      text: 'const a = 1;',
    },
  ]);

  assert.deepEqual(stripped, [
    { type: 'text', text: '请看' },
    {
      type: 'image',
      id: 'image-1',
      path: 'D:\\workspace\\.codem-attachments\\a.png',
      name: 'a.png',
      mimeType: 'image/png',
      size: 5,
    },
    {
      type: 'file_text',
      id: 'file-1',
      path: 'D:\\workspace\\src\\a.ts',
      name: 'a.ts',
      mimeType: 'text/typescript',
      size: 12,
      textBytes: 12,
    },
  ]);
});

test('summarizeInputContentBlocksForTrace reports counts without leaking content', () => {
  const summary = summarizeInputContentBlocksForTrace([
    { type: 'text', text: '秘密文本' },
    {
      type: 'image',
      path: 'D:\\workspace\\.codem-attachments\\a.png',
      name: 'a.png',
      mimeType: 'image/png',
      data: 'SGVsbG8=',
    },
    {
      type: 'file_reference',
      path: 'D:\\workspace\\large.log',
      name: 'large.log',
      reason: 'too_large',
    },
  ]);

  assert.equal(summary, 'text=1, images=1, fileText=0, fileReferences=1, metadata=0, imageBytes=5');
  assert.doesNotMatch(summary, /SGVsbG8=/);
  assert.doesNotMatch(summary, /秘密文本/);
});
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
node --import tsx --test src\lib\input-content-blocks.test.ts
```

Expected: FAIL because `src/lib/input-content-blocks.ts` does not exist.

- [ ] **Step 3: Add neutral block types**

In `src/types.ts`, add exported types near `UserImageAttachment`:

```ts
export type InputContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      id?: string;
      path?: string;
      name?: string;
      mimeType?: string;
      size?: number;
      data?: string;
    }
  | {
      type: 'file_text';
      id?: string;
      path: string;
      name: string;
      mimeType?: string;
      size?: number;
      text: string;
    }
  | {
      type: 'file_reference';
      id?: string;
      path: string;
      name: string;
      mimeType?: string;
      size?: number;
      reason?: 'too_large' | 'binary' | 'unsupported' | 'provider_unsupported';
    }
  | {
      type: 'attachment_metadata';
      id?: string;
      name: string;
      mimeType?: string;
      size?: number;
      reason: string;
    };

export type InputContentBlockSummary =
  | { type: 'text'; text: string }
  | Omit<Extract<InputContentBlock, { type: 'image' }>, 'data'>
  | (Omit<Extract<InputContentBlock, { type: 'file_text' }>, 'text'> & { textBytes: number })
  | Extract<InputContentBlock, { type: 'file_reference' }>
  | Extract<InputContentBlock, { type: 'attachment_metadata' }>;
```

- [ ] **Step 4: Implement normalization helpers**

Create `src/lib/input-content-blocks.ts`:

```ts
import type { InputContentBlock, InputContentBlockSummary, UserImageAttachment } from '../types';

type NormalizeInput = {
  prompt?: string;
  contentBlocks?: InputContentBlock[];
  imageAttachments?: UserImageAttachment[];
};

export function normalizeInputContentBlocks(input: NormalizeInput): InputContentBlock[] {
  const directBlocks = normalizeDirectBlocks(input.contentBlocks);
  if (directBlocks.length > 0) {
    return directBlocks;
  }

  const blocks: InputContentBlock[] = [];
  const prompt = input.prompt?.trim() ?? '';
  if (prompt) {
    blocks.push({ type: 'text', text: prompt });
  }
  for (const attachment of input.imageAttachments ?? []) {
    const mimeType = attachment.mimeType?.trim();
    const data = attachment.data?.trim();
    if (!mimeType && !attachment.path) {
      continue;
    }
    blocks.push({
      type: 'image',
      id: attachment.id,
      path: attachment.path,
      name: attachment.name,
      mimeType,
      size: attachment.size,
      data,
    });
  }
  return blocks;
}

export function stripTransientInputBlockData(blocks: InputContentBlock[] | undefined): InputContentBlockSummary[] | undefined {
  if (!blocks?.length) {
    return blocks;
  }

  return blocks.map((block) => {
    if (block.type === 'image') {
      const { data: _data, ...safeBlock } = block;
      return safeBlock;
    }
    if (block.type === 'file_text') {
      const { text, ...safeBlock } = block;
      return {
        ...safeBlock,
        textBytes: new TextEncoder().encode(text).length,
      };
    }
    return block;
  });
}

export function summarizeInputContentBlocksForTrace(blocks: InputContentBlock[]): string {
  let text = 0;
  let images = 0;
  let fileText = 0;
  let fileReferences = 0;
  let metadata = 0;
  let imageBytes = 0;

  for (const block of blocks) {
    if (block.type === 'text') text += 1;
    if (block.type === 'image') {
      images += 1;
      if (block.data?.trim()) {
        imageBytes += Buffer.from(block.data.trim(), 'base64').length;
      }
    }
    if (block.type === 'file_text') fileText += 1;
    if (block.type === 'file_reference') fileReferences += 1;
    if (block.type === 'attachment_metadata') metadata += 1;
  }

  return `text=${text}, images=${images}, fileText=${fileText}, fileReferences=${fileReferences}, metadata=${metadata}, imageBytes=${imageBytes}`;
}

function normalizeDirectBlocks(blocks: InputContentBlock[] | undefined): InputContentBlock[] {
  if (!Array.isArray(blocks)) {
    return [];
  }

  return blocks
    .map((block) => normalizeBlock(block))
    .filter((block): block is InputContentBlock => Boolean(block));
}

function normalizeBlock(block: InputContentBlock): InputContentBlock | null {
  if (!block || typeof block !== 'object') {
    return null;
  }

  if (block.type === 'text') {
    const text = block.text.trim();
    return text ? { type: 'text', text } : null;
  }
  if (block.type === 'image') {
    return block.path || block.data ? block : null;
  }
  if (block.type === 'file_text') {
    return block.path && block.name && block.text ? block : null;
  }
  if (block.type === 'file_reference') {
    return block.path && block.name ? block : null;
  }
  if (block.type === 'attachment_metadata') {
    return block.name && block.reason ? block : null;
  }
  return null;
}
```

- [ ] **Step 5: Run Task 1 tests**

Run:

```powershell
node --import tsx --test src\lib\input-content-blocks.test.ts
```

Expected: PASS.

- [ ] **Step 6: Stage new code files only**

Run:

```powershell
git add src\lib\input-content-blocks.ts src\lib\input-content-blocks.test.ts
```

Expected: files staged. Do not commit.

## Task 2: Claude Adapter Consumes Neutral Blocks

**Files:**

- Modify: `server/lib/claude-service.ts`
- Modify: `server/lib/claude-service.spawn.test.ts`
- Modify: `src/lib/claude-run-attachments.ts`
- Modify: `src/lib/claude-run-attachments.test.ts`

- [ ] **Step 1: Add failing tests for Claude adapter behavior**

In `server/lib/claude-service.spawn.test.ts`, add tests near existing image trace tests:

```ts
test('Claude input message is built from neutral content blocks', () => {
  const message = buildClaudeInputMessage({
    threadId: 'thread-a',
    turnId: 'turn-a',
    prompt: '',
    contentBlocks: [
      { type: 'text', text: '请看' },
      {
        type: 'image',
        mimeType: 'image/png',
        data: 'SGVsbG8=',
        path: 'D:\\workspace\\.codem-attachments\\a.png',
        name: 'a.png',
      },
      {
        type: 'file_reference',
        path: 'D:\\workspace\\large.log',
        name: 'large.log',
        reason: 'too_large',
      },
    ],
    workingDirectory: 'D:\\workspace',
    permissionMode: 'default',
  });

  assert.deepEqual(message.message.content, [
    { type: 'text', text: '请看' },
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'SGVsbG8=',
      },
    },
    {
      type: 'text',
      text: '文件已作为路径引用提供：D:\\workspace\\large.log\n原因：too_large',
    },
  ]);
});

test('Claude input trace summarizes neutral blocks without exposing payloads', () => {
  const summary = summarizeClaudeInputForTrace({
    prompt: '',
    contentBlocks: [
      { type: 'text', text: '秘密' },
      { type: 'image', mimeType: 'image/png', data: 'SGVsbG8=' },
      { type: 'file_reference', path: 'D:\\workspace\\large.log', name: 'large.log' },
    ],
  });

  assert.equal(summary, 'text=1, images=1, fileText=0, fileReferences=1, metadata=0, imageBytes=5');
  assert.doesNotMatch(summary, /SGVsbG8=/);
  assert.doesNotMatch(summary, /秘密/);
});
```

- [ ] **Step 2: Run failing adapter tests**

Run:

```powershell
node --import tsx --test server\lib\claude-service.spawn.test.ts
```

Expected: FAIL because `StreamInput` does not accept `contentBlocks` yet.

- [ ] **Step 3: Extend backend stream input type**

In `server/lib/claude-service.ts`, update `StreamInput` to include:

```ts
contentBlocks?: InputContentBlock[];
```

Import the neutral type:

```ts
import type { InputContentBlock } from '../../src/types';
import { normalizeInputContentBlocks, summarizeInputContentBlocksForTrace } from '../../src/lib/input-content-blocks';
```

- [ ] **Step 4: Convert blocks to Claude stdin content**

Replace image-only content construction in `buildClaudeInputMessage` with a helper shaped like:

```ts
function buildClaudeContentBlocksFromInput(input: StreamInput): ClaudeInputContentBlock[] {
  const inputBlocks = normalizeInputContentBlocks({
    prompt: input.prompt,
    contentBlocks: input.contentBlocks,
    imageAttachments: input.imageAttachments?.map((attachment) => ({
      id: crypto.randomUUID(),
      path: '',
      name: 'image',
      mimeType: attachment.mimeType,
      data: attachment.data,
    })),
  });

  return inputBlocks.flatMap((block): ClaudeInputContentBlock[] => {
    if (block.type === 'text') {
      return [{ type: 'text', text: block.text }];
    }
    if (block.type === 'image' && block.mimeType && block.data) {
      return [{
        type: 'image',
        source: {
          type: 'base64',
          media_type: block.mimeType,
          data: block.data,
        },
      }];
    }
    if (block.type === 'file_text') {
      return [{
        type: 'text',
        text: `文件 ${block.path} 内容：\n\n${block.text}`,
      }];
    }
    if (block.type === 'file_reference') {
      return [{
        type: 'text',
        text: block.reason
          ? `文件已作为路径引用提供：${block.path}\n原因：${block.reason}`
          : `文件已作为路径引用提供：${block.path}`,
      }];
    }
    if (block.type === 'attachment_metadata') {
      return [{
        type: 'text',
        text: `附件未直接发送：${block.name}\n原因：${block.reason}`,
      }];
    }
    return [];
  });
}
```

Then make `buildClaudeInputMessage` call that helper for user prompts.

- [ ] **Step 5: Update trace summary**

Update `summarizeClaudeInputForTrace` so it uses `summarizeInputContentBlocksForTrace` when `contentBlocks` exists, while preserving current image-only behavior for legacy callers:

```ts
export function summarizeClaudeInputForTrace(input: Pick<StreamInput, 'prompt' | 'imageAttachments' | 'contentBlocks'>) {
  const blocks = normalizeInputContentBlocks({
    prompt: input.prompt,
    contentBlocks: input.contentBlocks,
    imageAttachments: input.imageAttachments?.map((attachment) => ({
      id: crypto.randomUUID(),
      path: '',
      name: 'image',
      mimeType: attachment.mimeType,
      data: attachment.data,
    })),
  });
  return summarizeInputContentBlocksForTrace(blocks);
}
```

- [ ] **Step 6: Run adapter tests**

Run:

```powershell
node --import tsx --test src\lib\input-content-blocks.test.ts server\lib\claude-service.spawn.test.ts
```

Expected: PASS.

## Task 3: HTTP Run And Guide Normalize To Blocks

**Files:**

- Modify: `server/index.ts`
- Modify: `server/lib/claude-service.ts`
- Modify: `server/lib/claude-service.spawn.test.ts`
- Modify: `tests/claude-run-session.test.ts`

- [ ] **Step 1: Add failing tests for run endpoint compatibility**

In `server/lib/claude-service.spawn.test.ts`, add static checks:

```ts
test('run and guide endpoints accept contentBlocks while preserving legacy attachments', () => {
  assert.match(serverSource, /request\.body\?\.contentBlocks/);
  assert.match(serverSource, /normalizeInputContentBlocks/);
  assert.match(serverSource, /contentBlocks,/);
  assert.match(serverSource, /submitRunGuidePrompt\(request\.params\.runId,\s*prompt,\s*guideImageAttachments,\s*guideContentBlocks\)/);
});
```

- [ ] **Step 2: Run failing server tests**

Run:

```powershell
node --import tsx --test server\lib\claude-service.spawn.test.ts
```

Expected: FAIL because endpoints do not read `contentBlocks`.

- [ ] **Step 3: Accept contentBlocks in `/api/claude/run`**

In `server/index.ts`, after legacy image attachment normalization, normalize blocks:

```ts
let contentBlocks: InputContentBlock[] = [];
try {
  contentBlocks = normalizeInputContentBlocks({
    prompt,
    contentBlocks: Array.isArray(request.body?.contentBlocks) ? request.body.contentBlocks : undefined,
    imageAttachments: imageAttachments.map((attachment, index) => ({
      id: `legacy-image-${index + 1}`,
      path: '',
      name: `image-${index + 1}`,
      mimeType: attachment.mimeType,
      data: attachment.data,
    })),
  });
} catch (error) {
  response.status(400).send(error instanceof Error ? error.message : '输入内容无效');
  return;
}
```

Change empty prompt validation from:

```ts
if (!prompt) {
  response.status(400).send('prompt 不能为空');
  return;
}
```

to:

```ts
if (contentBlocks.length === 0 && !toolResult) {
  response.status(400).send('发送内容不能为空');
  return;
}
```

Pass `contentBlocks` into `createClaudeStream`.

- [ ] **Step 4: Accept contentBlocks in guide endpoint**

In `server/index.ts`, inside `/api/claude/run/:runId/guide`, normalize guide blocks with the same helper and pass `guideContentBlocks` into `submitRunGuidePrompt`.

Target call shape:

```ts
submitRunGuidePrompt(request.params.runId, prompt, guideImageAttachments, guideContentBlocks);
```

- [ ] **Step 5: Update guide service signature**

In `server/lib/claude-service.ts`, change:

```ts
export function submitRunGuidePrompt(runId: string, prompt: string, imageAttachments: ClaudeInputImageAttachment[] = []) {
```

to:

```ts
export function submitRunGuidePrompt(
  runId: string,
  prompt: string,
  imageAttachments: ClaudeInputImageAttachment[] = [],
  contentBlocks?: InputContentBlock[],
) {
```

Ensure the guide `StreamInput` uses `contentBlocks` and does not spread the original run input.

- [ ] **Step 6: Run endpoint tests**

Run:

```powershell
node --import tsx --test server\lib\claude-service.spawn.test.ts tests\claude-run-session.test.ts
```

Expected: PASS.

## Task 4: Frontend Runtime Sends Blocks Through Queue And Guide

**Files:**

- Modify: `src/hooks/useClaudeRun.ts`
- Modify: `src/lib/queued-prompts.test.ts`
- Modify: `src/lib/claude-run-attachments.ts`
- Modify: `src/lib/claude-run-attachments.test.ts`

- [ ] **Step 1: Add failing helper tests for block request projection**

In `src/lib/claude-run-attachments.test.ts`, add:

```ts
import { buildRunContentBlocks, stripTransientContentBlockData } from './claude-run-attachments.js';

test('buildRunContentBlocks keeps transient data for runtime request only', () => {
  const blocks = buildRunContentBlocks({
    prompt: '请看',
    attachments: [
      {
        id: 'image-1',
        path: 'D:\\workspace\\.codem-attachments\\a.png',
        name: 'a.png',
        mimeType: 'image/png',
        size: 5,
        data: 'SGVsbG8=',
      },
    ],
  });

  assert.deepEqual(blocks, [
    { type: 'text', text: '请看' },
    {
      type: 'image',
      id: 'image-1',
      path: 'D:\\workspace\\.codem-attachments\\a.png',
      name: 'a.png',
      mimeType: 'image/png',
      size: 5,
      data: 'SGVsbG8=',
    },
  ]);
});

test('stripTransientContentBlockData removes payloads for turn history', () => {
  const safe = stripTransientContentBlockData([
    { type: 'text', text: '请看' },
    {
      type: 'image',
      id: 'image-1',
      path: 'D:\\workspace\\.codem-attachments\\a.png',
      name: 'a.png',
      mimeType: 'image/png',
      data: 'SGVsbG8=',
    },
  ]);

  assert.equal('data' in safe![1], false);
});
```

- [ ] **Step 2: Implement frontend block helper wrappers**

In `src/lib/claude-run-attachments.ts`, keep current exports for compatibility and add:

```ts
import type { InputContentBlock, InputContentBlockSummary, UserImageAttachment } from '../types';
import { normalizeInputContentBlocks, stripTransientInputBlockData } from './input-content-blocks';

export function buildRunContentBlocks(input: {
  prompt: string;
  attachments?: UserImageAttachment[];
  contentBlocks?: InputContentBlock[];
}): InputContentBlock[] {
  return normalizeInputContentBlocks({
    prompt: input.prompt,
    contentBlocks: input.contentBlocks,
    imageAttachments: input.attachments,
  });
}

export function stripTransientContentBlockData(blocks: InputContentBlock[] | undefined): InputContentBlockSummary[] | undefined {
  return stripTransientInputBlockData(blocks);
}
```

- [ ] **Step 3: Carry blocks in queue types**

In `src/hooks/useClaudeRun.ts`, extend `QueuedPrompt` and `PromptSubmission`:

```ts
contentBlocks?: InputContentBlock[];
```

In `enqueuePrompt`, persist `contentBlocks: submission.contentBlocks`.

- [ ] **Step 4: Send blocks on run start**

In `startRun`, build request blocks:

```ts
const requestContentBlocks = buildRunContentBlocks({
  prompt: trimmedPrompt,
  attachments: options?.attachments,
  contentBlocks: options?.contentBlocks,
});
const turnContentBlocks = stripTransientContentBlockData(requestContentBlocks);
```

Send:

```ts
contentBlocks: requestContentBlocks,
```

Keep legacy `attachments` for one compatibility pass until backend tests prove blocks path is stable.

- [ ] **Step 5: Preserve blocks through guide and queued starts**

In `guideQueuedPrompt`, send:

```ts
contentBlocks: buildRunContentBlocks({
  prompt: targetPrompt.prompt,
  attachments: targetPrompt.attachments,
  contentBlocks: targetPrompt.contentBlocks,
}),
```

In `maybeStartQueuedPrompt`, pass:

```ts
contentBlocks: nextPrompt.contentBlocks,
```

- [ ] **Step 6: Run runtime helper tests**

Run:

```powershell
node --import tsx --test src\lib\claude-run-attachments.test.ts src\lib\queued-prompts.test.ts
```

Expected: PASS.

## Task 5: Small Text/Image Upload Classification In Composer

**Files:**

- Create: `src/lib/composer-input-files.ts`
- Create: `src/lib/composer-input-files.test.ts`
- Modify: `src/components/Composer.tsx`
- Modify: `server/index.ts`

- [ ] **Step 1: Write failing tests for file classification**

Create `src/lib/composer-input-files.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyComposerFile,
  isSmallTextLikeFile,
  supportedComposerUploadAccept,
} from './composer-input-files.js';

test('classifyComposerFile supports images and small text/code files', () => {
  assert.deepEqual(classifyComposerFile({ name: 'a.png', type: 'image/png', size: 10 }), {
    kind: 'image',
    mimeType: 'image/png',
  });
  assert.deepEqual(classifyComposerFile({ name: 'App.tsx', type: '', size: 100 }), {
    kind: 'text',
    mimeType: 'text/plain',
  });
});

test('classifyComposerFile marks large text files as references', () => {
  assert.deepEqual(classifyComposerFile({ name: 'large.log', type: 'text/plain', size: 1024 * 1024 + 1 }), {
    kind: 'reference',
    reason: 'too_large',
  });
});

test('isSmallTextLikeFile recognizes common code extensions', () => {
  assert.equal(isSmallTextLikeFile({ name: 'server/index.ts', type: '', size: 100 }), true);
  assert.equal(isSmallTextLikeFile({ name: 'archive.zip', type: 'application/zip', size: 100 }), false);
});

test('supportedComposerUploadAccept includes image and text/code formats only for first stage', () => {
  assert.match(supportedComposerUploadAccept, /image\/png/);
  assert.match(supportedComposerUploadAccept, /\.tsx/);
  assert.doesNotMatch(supportedComposerUploadAccept, /pdf/);
  assert.doesNotMatch(supportedComposerUploadAccept, /docx/);
});
```

- [ ] **Step 2: Implement file classification**

Create `src/lib/composer-input-files.ts`:

```ts
const MAX_INLINE_TEXT_BYTES = 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  'css', 'csv', 'env', 'go', 'html', 'ini', 'java', 'js', 'json', 'jsx', 'log',
  'md', 'properties', 'py', 'rs', 'scss', 'sql', 'toml', 'ts', 'tsx', 'txt',
  'xml', 'yaml', 'yml',
]);

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export const supportedComposerUploadAccept = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.css', '.csv', '.env', '.go', '.html', '.ini', '.java', '.js', '.json',
  '.jsx', '.log', '.md', '.properties', '.py', '.rs', '.scss', '.sql',
  '.toml', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
].join(',');

type FileLike = { name: string; type: string; size: number };

export function classifyComposerFile(file: FileLike) {
  const mimeType = file.type.toLowerCase();
  if (IMAGE_MIME_TYPES.has(mimeType)) {
    return { kind: 'image' as const, mimeType };
  }
  if (isTextLikeFile(file)) {
    if (file.size <= MAX_INLINE_TEXT_BYTES) {
      return { kind: 'text' as const, mimeType: mimeType || 'text/plain' };
    }
    return { kind: 'reference' as const, reason: 'too_large' as const };
  }
  return { kind: 'unsupported' as const, reason: 'unsupported' as const };
}

export function isSmallTextLikeFile(file: FileLike) {
  return file.size <= MAX_INLINE_TEXT_BYTES && isTextLikeFile(file);
}

function isTextLikeFile(file: FileLike) {
  const mimeType = file.type.toLowerCase();
  if (mimeType.startsWith('text/')) return true;
  if (mimeType.includes('json') || mimeType.includes('xml') || mimeType.includes('yaml')) return true;
  const ext = file.name.split('.').pop()?.toLowerCase();
  return Boolean(ext && TEXT_EXTENSIONS.has(ext));
}
```

- [ ] **Step 3: Run classification tests**

Run:

```powershell
node --import tsx --test src\lib\composer-input-files.test.ts
```

Expected: PASS.

- [ ] **Step 4: Update Composer pending attachment model**

In `src/components/Composer.tsx`, replace `PendingImageAttachment` with:

```ts
type PendingComposerAttachment =
  | {
      id: string;
      kind: 'image';
      file: File;
      previewUrl: string;
    }
  | {
      id: string;
      kind: 'file_text';
      file: File;
      text: string;
    }
  | {
      id: string;
      kind: 'file_reference';
      file: File;
      reason: 'too_large' | 'unsupported';
    };
```

Update state and refs from `PendingImageAttachment[]` to `PendingComposerAttachment[]`.

- [ ] **Step 5: Update file picker accept and label**

Change:

```tsx
accept="image/*"
```

to:

```tsx
accept={supportedComposerUploadAccept}
```

Change menu label from `添加图片` to `添加附件`.

- [ ] **Step 6: Read small text files into pending attachments**

Replace image-only `appendAttachments(files)` with:

```ts
async function appendAttachments(files: File[]) {
  const nextAttachments: PendingComposerAttachment[] = [];
  let skipped = 0;

  for (const file of files) {
    const classification = classifyComposerFile(file);
    if (classification.kind === 'image') {
      nextAttachments.push({
        id: crypto.randomUUID(),
        kind: 'image',
        file,
        previewUrl: URL.createObjectURL(file),
      });
      continue;
    }
    if (classification.kind === 'text') {
      nextAttachments.push({
        id: crypto.randomUUID(),
        kind: 'file_text',
        file,
        text: await readFileAsText(file),
      });
      continue;
    }
    if (classification.kind === 'reference') {
      nextAttachments.push({
        id: crypto.randomUUID(),
        kind: 'file_reference',
        file,
        reason: classification.reason,
      });
      continue;
    }
    skipped += 1;
  }

  setAttachments((current) => [...current, ...nextAttachments]);
  if (nextAttachments.length > 0) {
    showToast(`已添加 ${nextAttachments.length} 个附件。`, 'success');
  }
  if (skipped > 0) {
    showToast(`已跳过 ${skipped} 个暂不支持的文件。`, 'info');
  }
}
```

Add:

```ts
function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file);
  });
}
```

- [ ] **Step 7: Submit pending attachments as contentBlocks**

In `handleSubmit`, build `contentBlocks` from `submittedDraft` and pending attachments. Use images through existing upload path, and small text files as `file_text` blocks:

```ts
const contentBlocks: InputContentBlock[] = submittedDraft.trim()
  ? [{ type: 'text', text: submittedDraft.trim() }]
  : [];

for (const attachment of submittedAttachments) {
  if (attachment.kind === 'image') {
    const uploaded = await uploadImageAttachments([attachment], workspace.trim());
    const image = uploaded[0];
    if (image) {
      contentBlocks.push({
        type: 'image',
        id: image.id,
        path: image.path,
        name: image.name,
        mimeType: image.mimeType,
        size: image.size,
        data: image.data,
      });
    }
  }
  if (attachment.kind === 'file_text') {
    contentBlocks.push({
      type: 'file_text',
      id: attachment.id,
      path: attachment.file.name,
      name: attachment.file.name || 'file.txt',
      mimeType: attachment.file.type || 'text/plain',
      size: attachment.file.size,
      text: attachment.text,
    });
  }
  if (attachment.kind === 'file_reference') {
    contentBlocks.push({
      type: 'attachment_metadata',
      id: attachment.id,
      name: attachment.file.name || 'file',
      mimeType: attachment.file.type || undefined,
      size: attachment.file.size,
      reason: attachment.reason === 'too_large' ? '文件超过 1MB，第一阶段不会内联发送。' : '文件类型暂不支持。',
    });
  }
}
```

Pass `contentBlocks` into `onSubmitPrompt`.

- [ ] **Step 8: Run Composer-related tests**

Run:

```powershell
node --import tsx --test src\lib\composer-input-files.test.ts src\lib\input-content-blocks.test.ts src\lib\claude-run-attachments.test.ts
```

Expected: PASS.

## Task 6: Lightweight @文件 References

**Files:**

- Create: `src/lib/file-reference-paths.ts`
- Create: `src/lib/file-reference-paths.test.ts`
- Modify: `server/index.ts`
- Modify: `src/components/Composer.tsx`

- [ ] **Step 1: Write failing tests for path parsing**

Create `src/lib/file-reference-paths.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dedupeFileReferencePaths,
  extractAtFileReferences,
  normalizePathForComparison,
} from './file-reference-paths.js';

test('normalizePathForComparison normalizes Windows paths for dedupe', () => {
  assert.equal(
    normalizePathForComparison('C:\\Workspace\\src\\App.tsx'),
    'c:/Workspace/src/App.tsx',
  );
});

test('dedupeFileReferencePaths removes slash and drive case duplicates', () => {
  assert.deepEqual(
    dedupeFileReferencePaths([
      'C:\\Workspace\\src\\App.tsx',
      'c:/Workspace/src/App.tsx',
      'D:\\Workspace\\src\\main.ts',
    ]),
    ['C:\\Workspace\\src\\App.tsx', 'D:\\Workspace\\src\\main.ts'],
  );
});

test('extractAtFileReferences reads quoted and unquoted @ paths', () => {
  assert.deepEqual(
    extractAtFileReferences('看看 @src/App.tsx 和 @"src/components/A B.tsx"'),
    ['src/App.tsx', 'src/components/A B.tsx'],
  );
});
```

- [ ] **Step 2: Implement path helpers**

Create `src/lib/file-reference-paths.ts`:

```ts
export function normalizePathForComparison(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return '';
  let normalized = trimmed.replace(/\\/g, '/');
  const drive = normalized.match(/^([A-Za-z]):(\/|$)/);
  if (drive) {
    normalized = `${drive[1]!.toLowerCase()}:${normalized.slice(2)}`;
  }
  return normalized;
}

export function dedupeFileReferencePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawPath of paths) {
    const path = rawPath.trim();
    const key = normalizePathForComparison(path);
    if (!path || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(path);
  }
  return result;
}

export function extractAtFileReferences(text: string): string[] {
  const references: string[] = [];
  const regex = /@(?:"([^"\n]+)"|'([^'\n]+)'|`([^`\n]+)`|([^\s@]+))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const value = match[1] ?? match[2] ?? match[3] ?? match[4] ?? '';
    if (value.trim()) {
      references.push(value.trim());
    }
  }
  return dedupeFileReferencePaths(references);
}
```

- [ ] **Step 3: Add backend search endpoint**

In `server/index.ts`, add a lightweight endpoint:

```ts
app.get('/api/system/files/search', async (request, response) => {
  const workingDirectory = typeof request.query.workingDirectory === 'string' ? request.query.workingDirectory.trim() : '';
  const query = typeof request.query.query === 'string' ? request.query.query.trim() : '';
  if (!workingDirectory) {
    response.status(400).send('workingDirectory 不能为空');
    return;
  }
  const root = path.resolve(workingDirectory);
  if (!(await isDirectoryAccessible(root))) {
    response.status(400).send(`目录不存在或不可访问：${root}`);
    return;
  }
  response.json({ files: await searchWorkspaceFiles(root, query) });
});
```

Add helper in the same file for first stage:

```ts
async function searchWorkspaceFiles(root: string, query: string) {
  const normalizedQuery = query.toLowerCase();
  const skipDirectories = new Set(['.git', 'node_modules', 'target', 'dist', '.next', '.venv', 'venv', '.codem-attachments']);
  const results: Array<{ path: string; rel: string; isDirectory: boolean }> = [];
  const stack: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];

  while (stack.length > 0 && results.length < 500) {
    const current = stack.pop()!;
    if (current.depth >= 4) continue;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(current.directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (results.length >= 500) break;
      if (entry.isDirectory() && skipDirectories.has(entry.name)) continue;
      const absolutePath = path.join(current.directory, entry.name);
      const rel = path.relative(root, absolutePath).replace(/\\/g, '/');
      if (!normalizedQuery || rel.toLowerCase().includes(normalizedQuery)) {
        results.push({ path: absolutePath, rel, isDirectory: entry.isDirectory() });
      }
      if (entry.isDirectory()) {
        stack.push({ directory: absolutePath, depth: current.depth + 1 });
      }
    }
  }

  return results.sort((a, b) => Number(a.isDirectory) - Number(b.isDirectory) || a.rel.length - b.rel.length);
}
```

Ensure `readdir` is imported from `node:fs/promises`.

- [ ] **Step 4: Add basic Composer @ detection**

In `Composer.tsx`, when `draft` and `selectionStart` indicate an active `@` token, call `/api/system/files/search` with debounce. Reuse the existing `PopoverPortal` pattern rather than introducing a new heavy input architecture.

Expected state shape:

```ts
const [fileReferenceQuery, setFileReferenceQuery] = useState<{ query: string; start: number; end: number } | null>(null);
const [fileReferenceResults, setFileReferenceResults] = useState<Array<{ path: string; rel: string; isDirectory: boolean }>>([]);
```

Expected insertion:

```ts
function applyFileReference(file: { path: string; rel: string }) {
  const active = fileReferenceQuery;
  if (!active) return;
  const replacement = `@${file.rel} `;
  const nextDraft = `${draft.slice(0, active.start)}${replacement}${draft.slice(active.end)}`;
  const nextCursor = active.start + replacement.length;
  handleDraftChange(nextDraft, nextCursor, nextCursor);
  updateDraftSelection(nextCursor, nextCursor);
  setFileReferenceQuery(null);
  setFileReferenceResults([]);
}
```

- [ ] **Step 5: Convert selected @ references to blocks on submit**

In `handleSubmit`, extract references from the submitted text, resolve them against `workspace`, and add `file_reference` blocks for paths that exist. Do not inline here yet unless Task 7 adds safe small-file reading.

Expected block:

```ts
contentBlocks.push({
  type: 'file_reference',
  path: absolutePath,
  name: path.basename(absolutePath),
});
```

Keep the visible prompt text intact for display.

- [ ] **Step 6: Run @文件 tests**

Run:

```powershell
node --import tsx --test src\lib\file-reference-paths.test.ts
```

Expected: PASS.

## Task 7: Safe History, Conversation Rendering, And Trace

**Files:**

- Modify: `src/types.ts`
- Modify: `src/components/ConversationTurn.tsx`
- Modify: `server/lib/workspace-store.ts`
- Modify: `server/lib/claude-service.spawn.test.ts`

- [ ] **Step 1: Add safe block summary to turns**

In `src/types.ts`, add:

```ts
userContentBlocks?: InputContentBlockSummary[];
```

to `ConversationTurn`.

Keep `userAttachments?: UserImageAttachment[]` during migration so existing history continues to render.

- [ ] **Step 2: Store safe summaries when creating turns**

In `useClaudeRun.ts`, when adding the optimistic turn, set:

```ts
userContentBlocks: turnContentBlocks,
```

Keep `userAttachments: turnAttachments` until the renderer fully switches to summaries.

- [ ] **Step 3: Render non-image blocks as chips**

In `ConversationTurn.tsx`, update the attachment renderer:

```tsx
function UserContentBlocks({ blocks }: { blocks: InputContentBlockSummary[] }) {
  const visibleBlocks = blocks.filter((block) => block.type !== 'text');
  if (visibleBlocks.length === 0) return null;

  return (
    <div className="user-message-attachments" aria-label="用户附件">
      {visibleBlocks.map((block, index) => {
        if (block.type === 'image' && block.path) {
          return <UserImageAttachmentCard key={`${block.type}-${index}`} attachment={block} />;
        }
        return (
          <figure key={`${block.type}-${index}`} className="user-message-attachment">
            <div className="user-message-attachment-file">
              <span>{block.type === 'file_text' ? '已内联' : '仅引用'}</span>
              <strong>{'name' in block ? block.name : '附件'}</strong>
            </div>
          </figure>
        );
      })}
    </div>
  );
}
```

Use existing classes first; add CSS only if the current layout breaks.

- [ ] **Step 4: Persist safe summaries**

In `server/lib/workspace-store.ts`, extend the existing `user_attachments_json` handling or add `user_content_blocks_json` if the store already has migration helpers nearby.

Safe serializer must reject payload fields:

```ts
function serializeUserContentBlocks(blocks: InputContentBlockSummary[] | undefined) {
  if (!blocks?.length) return null;
  return JSON.stringify(blocks.map((block) => {
    if (block.type === 'image') {
      const { data: _data, ...safeBlock } = block as Record<string, unknown>;
      return safeBlock;
    }
    if (block.type === 'file_text') {
      const { text: _text, ...safeBlock } = block as Record<string, unknown>;
      return safeBlock;
    }
    return block;
  }));
}
```

- [ ] **Step 5: Add trace/static safety checks**

In `server/lib/claude-service.spawn.test.ts`, ensure trace no longer uses `prompt.length` only:

```ts
test('trace summary uses content block summary instead of raw prompt details', () => {
  const body = extractFunctionBody('summarizeClaudeInputForTrace');
  assert.match(body, /summarizeInputContentBlocksForTrace/);
  assert.doesNotMatch(body, /input\.prompt\.length/);
});
```

- [ ] **Step 6: Run safety tests**

Run:

```powershell
node --import tsx --test server\lib\claude-service.spawn.test.ts src\lib\input-content-blocks.test.ts
```

Expected: PASS.

## Task 8: Final Verification

**Files:**

- No new files.

- [ ] **Step 1: Run targeted tests**

Run:

```powershell
node --import tsx --test tests\composer-attachments.test.ts src\lib\input-content-blocks.test.ts src\lib\claude-run-attachments.test.ts src\lib\composer-input-files.test.ts src\lib\file-reference-paths.test.ts src\lib\queued-prompts.test.ts tests\claude-run-session.test.ts server\lib\claude-service.spawn.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Check diff for accidental payload leaks**

Run:

```powershell
git diff -- src server tests | Select-String -Pattern 'base64|data:|SGVsbG8=|Read.*图片|Grep.*图片'
```

Expected: only test fixtures and intentional validation text appear. No persisted history, trace, or debug code stores raw base64.

- [ ] **Step 3: Check whitespace**

Run:

```powershell
git diff --check
```

Expected: no whitespace errors. CRLF warnings may appear on existing files; do not rewrite files solely to change line endings.

- [ ] **Step 4: Manual smoke test without build**

Use the running dev service if available. Do not run a production build.

Smoke scenarios:

- Paste or choose a PNG, send it, confirm the user turn shows the image and the request reaches Claude.
- Send only an image without text, confirm it is accepted.
- Attach a small `.ts` or `.md` file, confirm it shows as an inline file chip and sends as `file_text`.
- Type `@src/` and pick a file, confirm it inserts a lightweight reference and sends a `file_reference`.
- Queue a message with an image while a run is active, then let it send after the active turn.
- Use guide on a queued image message, confirm guide uses only that queued message's blocks.

- [ ] **Step 5: Stage newly created code files**

Run:

```powershell
git add src\lib\input-content-blocks.ts src\lib\input-content-blocks.test.ts src\lib\composer-input-files.ts src\lib\composer-input-files.test.ts src\lib\file-reference-paths.ts src\lib\file-reference-paths.test.ts
```

Expected: only newly created code/test files are staged. Do not commit.

## Self-Review Checklist

- Spec coverage: first-stage neutral blocks, Claude adapter, image fallback, small text/code attachments, basic `@文件`, queue, guide, trace, and safe history are covered.
- Scope guard: PDF, DOCX, long paste, complex drag-drop, full previewer, and Composer rewrite are explicitly excluded.
- Type consistency: `InputContentBlock` and `InputContentBlockSummary` are introduced first and reused by later tasks.
- Testing: each implementation task has a targeted `node --import tsx --test` command.
- Project constraints: no production build, no automatic git commit, Windows PowerShell commands only.

## Execution Choice

Plan complete and saved to `docs/superpowers/plans/2026-05-25-chat-input-content-blocks.md`. Two execution options:

1. Subagent-Driven (recommended) - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. Inline Execution - execute tasks in this session using executing-plans, batch execution with checkpoints.
