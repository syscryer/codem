import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { renderMarkdownImage } from './markdown-image';

test('renderMarkdownImage adds constrained class and lazy loading attributes', () => {
  const html = renderToStaticMarkup(
    renderMarkdownImage({
      src: 'https://example.com/huge.png',
      alt: 'huge image',
      title: 'preview',
    }),
  );

  assert.match(html, /class="markdown-inline-image"/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /decoding="async"/);
  assert.match(html, /src="https:\/\/example\.com\/huge\.png"/);
  assert.match(html, /alt="huge image"/);
  assert.match(html, /title="preview"/);
});

test('renderMarkdownImage renders clickable preview trigger when preview handler is provided', () => {
  const html = renderToStaticMarkup(
    renderMarkdownImage({
      src: 'https://example.com/previewable.png',
      alt: 'previewable image',
      onPreview: () => undefined,
    }),
  );

  assert.match(html, /<button[^>]*type="button"/);
  assert.match(html, /class="markdown-inline-image-button"/);
  assert.match(html, /aria-label="预览图片：previewable image"/);
  assert.match(html, /class="markdown-inline-image"/);
});
