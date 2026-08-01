import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  classifyMarkdownLink,
  isExternalHttpUrl,
  openExternalUrl,
  renderMarkdownLink,
} from './markdown-link.js';

const conversationTurnSource = readFileSync(new URL('../components/ConversationTurn.tsx', import.meta.url), 'utf8');
const rightWorkbenchSource = readFileSync(new URL('../components/RightWorkbench.tsx', import.meta.url), 'utf8');
const tauriMainSource = readFileSync(new URL('../../src-tauri/src/main.rs', import.meta.url), 'utf8');

test('assistant Markdown links use the shared external link renderer', () => {
  assert.match(conversationTurnSource, /import \{ renderMarkdownLink \} from '\.\.\/lib\/markdown-link';/);
  assert.match(
    conversationTurnSource,
    /a\(\{ href, title, children \}\) \{\s*return renderMarkdownLink\(\{[\s\S]*?onOpenLocalFile,[\s\S]*?onOpenWebUrl,[\s\S]*?onOpenWebContextMenu,[\s\S]*?\}\);\s*\}/,
  );
});

test('workbench Markdown preview links use the shared external link renderer', () => {
  assert.match(rightWorkbenchSource, /import \{ renderMarkdownLink \} from '\.\.\/lib\/markdown-link';/);
  assert.match(
    rightWorkbenchSource,
    /a\(\{ href, title, children \}\) \{\s*return renderMarkdownLink\(\{ href, title, children \}\);\s*\}/,
  );
});

test('desktop shell exposes a safe system-browser opener for web URLs', () => {
  assert.match(tauriMainSource, /fn open_external_url\(url: String\) -> Result<\(\), String>/);
  assert.match(tauriMainSource, /match parsed\.scheme\(\) \{\s*"http" \| "https" =>/);
  assert.match(tauriMainSource, /platform::open_external_url\(url\.as_str\(\)\)/);
  assert.match(tauriMainSource, /generate_handler!\[[\s\S]*open_external_url,/);
  assert.match(tauriMainSource, /generate_handler!\[[\s\S]*show_thread_notification,/);
});

test('renderMarkdownLink marks web links as external browser targets', () => {
  const html = renderToStaticMarkup(
    renderMarkdownLink({
      href: 'https://example.com/docs',
      title: 'Example docs',
      children: 'Example',
    }),
  );

  assert.match(html, /href="https:\/\/example\.com\/docs"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /title="Example docs"/);
});

test('renderMarkdownLink keeps local links inside the app', () => {
  const html = renderToStaticMarkup(
    renderMarkdownLink({
      href: '#details',
      children: 'Details',
    }),
  );

  assert.match(html, /href="#details"/);
  assert.doesNotMatch(html, /target="_blank"/);
  assert.doesNotMatch(html, /rel="noopener noreferrer"/);
});

test('isExternalHttpUrl only accepts http and https URLs', () => {
  assert.equal(isExternalHttpUrl('https://example.com'), true);
  assert.equal(isExternalHttpUrl('http://example.com'), true);
  assert.equal(isExternalHttpUrl('/local/path'), false);
  assert.equal(isExternalHttpUrl('#anchor'), false);
  assert.equal(isExternalHttpUrl('javascript:alert(1)'), false);
});

test('classifyMarkdownLink separates workspace files from navigation and unsafe protocols', () => {
  assert.deepEqual(classifyMarkdownLink('docs/prd.md#scope'), {
    kind: 'local-file',
    path: 'docs/prd.md',
  });
  assert.deepEqual(classifyMarkdownLink('D:\\project\\docs\\prd.md'), {
    kind: 'local-file',
    path: 'D:\\project\\docs\\prd.md',
  });
  assert.deepEqual(classifyMarkdownLink('#scope'), { kind: 'anchor' });
  assert.deepEqual(classifyMarkdownLink('https://example.com/docs'), {
    kind: 'external',
    url: 'https://example.com/docs',
  });
  assert.deepEqual(classifyMarkdownLink('javascript:alert(1)'), { kind: 'unsupported' });
});

test('classifyMarkdownLink decodes encoded unicode and spaces in local file paths', () => {
  assert.deepEqual(
    classifyMarkdownLink('%E4%B8%AD%E6%96%87%20%E6%96%87%E6%A1%A3.md'),
    { kind: 'local-file', path: '中文 文档.md' },
  );
});

test('web links delegate left click and context menu actions', () => {
  const opened: string[] = [];
  const contextMenus: Array<{ url: string; x: number; y: number }> = [];
  const element = renderMarkdownLink({
    href: 'https://example.com/docs',
    children: 'Docs',
    onOpenWebUrl: (url) => opened.push(url),
    onOpenWebContextMenu: (target) => contextMenus.push(target),
  });
  const props = element.props as {
    onClick: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
    onContextMenu: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
  };
  props.onClick({ preventDefault() {} } as ReactMouseEvent<HTMLAnchorElement>);
  props.onContextMenu({
    preventDefault() {},
    clientX: 12,
    clientY: 24,
  } as ReactMouseEvent<HTMLAnchorElement>);

  assert.deepEqual(opened, ['https://example.com/docs']);
  assert.deepEqual(contextMenus, [{ url: 'https://example.com/docs', x: 12, y: 24 }]);
});

test('local file links delegate context menu actions without changing left click behavior', () => {
  const opened: string[] = [];
  const contextMenus: Array<{ path: string; x: number; y: number }> = [];
  const element = renderMarkdownLink({
    href: 'docs/中文 验收.md#result',
    children: '打开文档',
    onOpenLocalFile: (path) => opened.push(path),
    onOpenLocalFileContextMenu: (target) => contextMenus.push(target),
  });
  const props = element.props as {
    onClick: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
    onContextMenu: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
  };

  props.onClick({ preventDefault() {} } as ReactMouseEvent<HTMLAnchorElement>);
  props.onContextMenu({
    preventDefault() {},
    clientX: 18,
    clientY: 32,
  } as ReactMouseEvent<HTMLAnchorElement>);

  assert.deepEqual(opened, ['docs/中文 验收.md']);
  assert.deepEqual(contextMenus, [{ path: 'docs/中文 验收.md', x: 18, y: 32 }]);
});

test('openExternalUrl reports rejected protocols without opening a window', async () => {
  assert.equal(await openExternalUrl('javascript:alert(1)'), false);
});
