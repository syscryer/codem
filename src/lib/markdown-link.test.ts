import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { isExternalHttpUrl, renderMarkdownLink } from './markdown-link.js';

const conversationTurnSource = readFileSync(new URL('../components/ConversationTurn.tsx', import.meta.url), 'utf8');
const rightWorkbenchSource = readFileSync(new URL('../components/RightWorkbench.tsx', import.meta.url), 'utf8');
const tauriMainSource = readFileSync(new URL('../../src-tauri/src/main.rs', import.meta.url), 'utf8');

test('assistant Markdown links use the shared external link renderer', () => {
  assert.match(conversationTurnSource, /import \{ renderMarkdownLink \} from '\.\.\/lib\/markdown-link';/);
  assert.match(
    conversationTurnSource,
    /a\(\{ href, title, children \}\) \{\s*return renderMarkdownLink\(\{ href, title, children \}\);\s*\}/,
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
  assert.match(tauriMainSource, /open_external_url,\s*show_thread_notification/s);
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
