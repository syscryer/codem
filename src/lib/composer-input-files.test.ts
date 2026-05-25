import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyComposerFile,
  isSmallTextLikeFile,
  supportedComposerUploadAccept,
} from './composer-input-files.js';

const composerSource = readFileSync(new URL('../components/Composer.tsx', import.meta.url), 'utf8');

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

test('Composer rebuilds uploaded image blocks in the original attachment order', () => {
  assert.match(
    composerSource,
    /const uploadedImageAttachmentsById = new Map\(uploadedAttachments\?\.map\(\(attachment\) => \[attachment\.id,\s*attachment\]\) \?\? \[\]\);/,
  );
  assert.match(composerSource, /for \(const attachment of submittedAttachments\) \{/);
  assert.match(composerSource, /if \(attachment\.kind === 'image'\) \{/);
  assert.match(composerSource, /const uploadedImage = uploadedImageAttachmentsById\.get\(attachment\.id\);/);
});
