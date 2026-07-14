import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyComposerFile,
  isSmallTextLikeFile,
  supportedComposerUploadAccept,
} from './composer-input-files.js';

const composerSource = readFileSync(new URL('../components/Composer.tsx', import.meta.url), 'utf8');

function extractFunctionBody(source: string, functionName: string) {
  const marker = `function ${functionName}`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `Missing function ${functionName}`);
  const bodyStart = source.indexOf('{', start);
  assert.ok(bodyStart >= 0, `Missing body for ${functionName}`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bodyStart + 1, index);
      }
    }
  }
  throw new Error(`Could not extract function ${functionName}`);
}

test('classifyComposerFile supports images and small text/code files', () => {
  assert.deepEqual(
    classifyComposerFile({
      name: 'a.png',
      type: 'image/png',
      size: 10,
    }),
    {
      kind: 'image',
      mimeType: 'image/png',
    },
  );

  assert.deepEqual(
    classifyComposerFile({
      name: 'App.tsx',
      type: '',
      size: 100,
    }),
    {
      kind: 'text',
      mimeType: 'text/plain',
    },
  );
});

test('classifyComposerFile accepts common image extensions when mimeType is empty', () => {
  assert.deepEqual(
    classifyComposerFile({
      name: 'screen-shot.PNG',
      type: '',
      size: 200,
    }),
    {
      kind: 'image',
      mimeType: 'image/png',
    },
  );
});

test('classifyComposerFile marks large text files as references', () => {
  assert.deepEqual(
    classifyComposerFile({
      name: 'large.log',
      type: 'text/plain',
      size: 1024 * 1024 + 1,
    }),
    {
      kind: 'reference',
      reason: 'too_large',
    },
  );
});

test('isSmallTextLikeFile recognizes common code extensions', () => {
  assert.equal(
    isSmallTextLikeFile({
      name: 'server/index.ts',
      type: '',
      size: 100,
    }),
    true,
  );

  assert.equal(
    isSmallTextLikeFile({
      name: 'archive.zip',
      type: 'application/zip',
      size: 100,
    }),
    false,
  );
});

test('supportedComposerUploadAccept includes image and text/code formats only for first stage', () => {
  assert.match(supportedComposerUploadAccept, /image\/png/);
  assert.match(supportedComposerUploadAccept, /\.tsx/);
  assert.doesNotMatch(supportedComposerUploadAccept, /pdf/i);
  assert.doesNotMatch(supportedComposerUploadAccept, /docx/i);
});

test('Composer only restores failed submissions inside the same draft scope and cleans previews on dispose', () => {
  assert.match(composerSource, /const submitDraftScopeKey = draftScopeKeyRef\.current;/);
  assert.match(composerSource, /if \(draftScopeKeyRef\.current === submitDraftScopeKey\) \{/);
  assert.match(composerSource, /disposeAttachmentPreviews\(submittedAttachments\);/);
  assert.match(composerSource, /useEffect\(\(\) => \{\s*return \(\) => \{\s*disposeAttachmentPreviews\(attachmentsRef\.current\);/s);
});

test('Composer clears submitted content before async attachment and @file resolution work', () => {
  const handleSubmitBody = extractFunctionBody(composerSource, 'handleSubmit');
  const clearIndex = handleSubmitBody.indexOf("setDraft('');", handleSubmitBody.indexOf("if (!submittedDraft.trim() && submittedAttachments.length === 0)"));
  const resolveIndex = handleSubmitBody.indexOf('await resolveExistingFileReferenceBlocks');
  const uploadIndex = handleSubmitBody.indexOf('await uploadImageAttachments');
  const submitIndex = handleSubmitBody.indexOf('const submitted = await onSubmitPrompt');
  const beforeSubmitBody = handleSubmitBody.slice(clearIndex, submitIndex);

  assert.ok(clearIndex > -1);
  assert.ok(resolveIndex > -1);
  assert.ok(uploadIndex > -1);
  assert.ok(submitIndex > -1);
  assert.ok(clearIndex < resolveIndex);
  assert.ok(clearIndex < uploadIndex);
  assert.doesNotMatch(beforeSubmitBody, /flushDraftPersistence\(\)/);
});

test('Composer only creates a preparing queue item when enabled attachments or @file references need async preparation', () => {
  const handleSubmitBody = extractFunctionBody(composerSource, 'handleSubmit');
  const preparingIndex = handleSubmitBody.indexOf("queueStatus: 'preparing'");
  const readyIndex = handleSubmitBody.indexOf("queueStatus: 'ready'");
  const resolveIndex = handleSubmitBody.indexOf('await resolveExistingFileReferenceBlocks');
  const uploadIndex = handleSubmitBody.indexOf('await uploadImageAttachments');

  assert.ok(preparingIndex > -1);
  assert.ok(readyIndex > -1);
  assert.ok(resolveIndex > -1);
  assert.ok(uploadIndex > -1);
  assert.match(
    handleSubmitBody,
    /const needsAsyncPreparation = allowAttachments && \(\s*submittedAttachments\.length > 0 \|\| extractAtFileReferences\(submittedDraft\)\.length > 0\s*\);/,
  );
  assert.match(handleSubmitBody, /if \(allowAttachments && workspace\.trim\(\)\) \{/);
  assert.match(handleSubmitBody, /const pendingQueueId = isRunning && needsAsyncPreparation \? crypto\.randomUUID\(\) : '';/);
  assert.ok(preparingIndex < resolveIndex);
  assert.ok(preparingIndex < uploadIndex);
  assert.ok(resolveIndex < readyIndex);
});

test('Composer restores submitted content when attachment preparation fails before final submit', () => {
  const handleSubmitBody = extractFunctionBody(composerSource, 'handleSubmit');

  assert.match(handleSubmitBody, /function restoreSubmittedContent\(\) \{/);
  assert.match(
    handleSubmitBody,
    /if \(!workspace\.trim\(\) && variant !== 'ordinary'\) \{[\s\S]*onRemoveQueuedPrompt\(pendingQueueId\);[\s\S]*restoreSubmittedContent\(\);[\s\S]*return;/,
  );
  assert.match(
    handleSubmitBody,
    /uploadedAttachments = variant === 'ordinary'[\s\S]*\? await buildInlineImageAttachments\(imageAttachments\)[\s\S]*: await uploadImageAttachments\(imageAttachments, workspace\.trim\(\)\);/,
  );
  assert.match(
    handleSubmitBody,
    /catch \(error\) \{[\s\S]*onRemoveQueuedPrompt\(pendingQueueId\);[\s\S]*restoreSubmittedContent\(\);[\s\S]*return;/,
  );
});

test('Composer rebuilds uploaded image blocks in the original attachment order', () => {
  assert.match(
    composerSource,
    /const uploadedImageAttachmentsById = new Map\(uploadedAttachments\?\.map\(\(attachment\) => \[attachment\.id,\s*attachment\]\) \?\? \[\]\);/,
  );
  assert.match(composerSource, /for \(const attachment of submittedAttachments\) \{/);
  assert.match(composerSource, /if \(attachment\.kind === 'image'\) \{/);
  assert.match(composerSource, /const uploadedImage = uploadedImageAttachmentsById\.get\(attachment\.id\);/);
});

test('Composer keeps successful attachment additions silent while preserving failure toasts', () => {
  const appendAttachmentsBody = extractFunctionBody(composerSource, 'appendAttachments');
  const appendDesktopPathsBody = extractFunctionBody(composerSource, 'appendDesktopPaths');

  assert.doesNotMatch(appendAttachmentsBody, /showToast\(`已添加/);
  assert.doesNotMatch(appendDesktopPathsBody, /showToast\(`已添加/);
  assert.match(appendAttachmentsBody, /showToast\(error instanceof Error \? error\.message : '附件读取失败。', 'error'\)/);
  assert.match(appendDesktopPathsBody, /showToast\('没有可添加的有效文件（已过滤敏感路径）。', 'info'\)/);
});

test('Composer keeps typing local and persists drafts only on explicit boundaries', () => {
  assert.match(composerSource, /const \[draft, setLocalDraft\] = useState\(persistedDraft\);/);
  assert.doesNotMatch(composerSource, /DRAFT_PERSIST_DEBOUNCE_MS/);
  assert.doesNotMatch(composerSource, /draftPersistTimerRef/);
  assert.doesNotMatch(composerSource, /scheduleDraftPersistence/);
  assert.match(composerSource, /onBlur=\{flushDraftPersistence\}/);

  const setDraftBody = extractFunctionBody(composerSource, 'setDraft');
  assert.match(setDraftBody, /setLocalDraft\(\(current\) => \(current === nextDraft \? current : nextDraft\)\);/);
  assert.doesNotMatch(setDraftBody, /onDraftChange\(nextDraft\)/);
  assert.doesNotMatch(setDraftBody, /flushDraftPersistence\(\)/);
});

test('Composer exposes an accessible label for the running stop control', () => {
  assert.match(
    composerSource,
    /className="send-button stop"[\s\S]*aria-label=\{isInterrupting \? '正在中断当前回合' : '中断当前回合'\}/,
  );
});
