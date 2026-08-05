import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { renderMarkdownLink } from './markdown-link.js';

const pluginUrl = new URL('./markdown-local-file-links.ts', import.meta.url);
const markdownContentSource = readFileSync(new URL('../components/MarkdownContent.tsx', import.meta.url), 'utf8');

test('会话 Markdown 启用本地文件链接宽松解析插件', () => {
  assert.match(markdownContentSource, /remarkPlugins=\{\[remarkGfm, remarkLocalFileLinks\]\}/);
});

test('宽松解析中文和空格组成的本地文件链接', async () => {
  assert.ok(existsSync(pluginUrl), 'markdown-local-file-links.ts should exist');
  const { remarkLocalFileLinks } = await import(pluginUrl.href);
  const html = renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: [remarkGfm, remarkLocalFileLinks],
        components: {
          a({ href, title, children }) {
            return renderMarkdownLink({ href, title, children });
          },
        },
      },
      '[打开中文文档](中文 文档.md)',
    ),
  );

  assert.match(html, /<a href="%E4%B8%AD%E6%96%87%20%E6%96%87%E6%A1%A3\.md">打开中文文档<\/a>/);
});

test('宽松解析不改写网页、不安全协议和行内代码', async () => {
  assert.ok(existsSync(pluginUrl), 'markdown-local-file-links.ts should exist');
  const { remarkLocalFileLinks } = await import(pluginUrl.href);
  const html = renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      { remarkPlugins: [remarkGfm, remarkLocalFileLinks] },
      '[网页](https://example.com/a b) [脚本](javascript:alert 1) `[代码](中文 文档.md)`',
    ),
  );

  assert.doesNotMatch(html, /<a [^>]*>网页<\/a>/);
  assert.match(html, /\[脚本\]\(javascript:alert 1\)/);
  assert.match(html, /<code>\[代码\]\(中文 文档\.md\)<\/code>/);
});
