import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dedupeFileReferencePaths,
  extractAtFileReferences,
  normalizePathForComparison,
  sortFileReferenceSearchResults,
  shouldSearchFileReferenceQuery,
} from './file-reference-paths.js';

const serverSource = readFileSync(new URL('../../server/index.ts', import.meta.url), 'utf8');
const composerSource = readFileSync(new URL('../components/Composer.tsx', import.meta.url), 'utf8');

test('normalizePathForComparison normalizes Windows paths for dedupe', () => {
  assert.equal(
    normalizePathForComparison('C:\\Workspace\\src\\App.tsx'),
    'c:/workspace/src/app.tsx',
  );
});

test('normalizePathForComparison treats path comparison as case-insensitive', () => {
  // Windows / macOS 默认大小写不敏感，用户敲 Src/App.tsx 也应该匹配到搜索结果里的 src/App.tsx
  assert.equal(
    normalizePathForComparison('Src/App.tsx'),
    normalizePathForComparison('src/App.tsx'),
  );
  assert.equal(
    normalizePathForComparison('C:\\Workspace\\src\\App.tsx'),
    normalizePathForComparison('c:/workspace/src/app.tsx'),
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

test('server search endpoint returns lightweight absolute path metadata', () => {
  assert.match(serverSource, /app\.get\('\/api\/system\/files\/search'/);
  assert.match(serverSource, /response\.json\(\{\s*files: await searchWorkspaceFiles\(root,\s*query\)\s*\}\)/s);
  assert.match(
    serverSource,
    /const results: FileReferenceSearchResult\[\] = \[\];/,
  );
  assert.match(
    serverSource,
    /results\.push\(\{\s*path: absolutePath,\s*rel,\s*isDirectory: entry\.isDirectory\(\),\s*\}\);/,
  );
});

test('server search uses shared file reference ranking and limits returned results', () => {
  assert.match(serverSource, /const MAX_WORKSPACE_FILE_SEARCH_RESULTS = 80;/);
  assert.match(
    serverSource,
    /sortFileReferenceSearchResults\(results,\s*normalizedQuery\)\.slice\(0,\s*MAX_WORKSPACE_FILE_SEARCH_RESULTS\)/,
  );
});

test('sortFileReferenceSearchResults keeps directories first inside the same match group', () => {
  const results = sortFileReferenceSearchResults(
    [
      { path: 'D:/repo/src/spec.ts', rel: 'src/spec.ts', isDirectory: false },
      { path: 'D:/repo/src/spec', rel: 'src/spec', isDirectory: true },
    ],
    'spec',
  );

  assert.deepEqual(
    results.map((result) => result.rel),
    ['src/spec', 'src/spec.ts'],
  );
});

test('sortFileReferenceSearchResults prioritizes basename and path segment matches before broad contains', () => {
  const results = sortFileReferenceSearchResults(
    [
      { path: 'D:/repo/openspec', rel: 'openspec', isDirectory: true },
      { path: 'D:/repo/src/components/SpecPanel.tsx', rel: 'src/components/SpecPanel.tsx', isDirectory: false },
      { path: 'D:/repo/.trellis/spec', rel: '.trellis/spec', isDirectory: true },
      { path: 'D:/repo/src/types.ts', rel: 'src/types.ts', isDirectory: false },
    ],
    'spec',
  );

  assert.deepEqual(
    results.map((result) => result.rel),
    ['.trellis/spec', 'src/components/SpecPanel.tsx', 'openspec', 'src/types.ts'],
  );
});

test('Composer inserts selected @ references using rel path and converts them into file_reference blocks', () => {
  assert.match(
    composerSource,
    /type FileReferenceSearchResult = \{\s*path: string;\s*rel: string;\s*isDirectory: boolean;\s*\};/,
  );
  assert.match(composerSource, /const replacement = needsQuoting \? `@"\$\{file\.rel\}" ` : `@\$\{file\.rel\} `;/);
  assert.match(composerSource, /type: 'file_reference',/);
  assert.match(composerSource, /path: matchedFile\.path,/);
  assert.match(composerSource, /name: getPathBasename\(matchedFile\.path\),/);
});

test('Composer 选择含空格/引号的文件时用 @"..." 形式插入，避免 extractAtFileReferences 截断', () => {
  assert.match(composerSource, /const needsQuoting = \/\[\\s"'`\]\/\.test\(file\.rel\);/);
});

test('extractAtFileReferences ignores standalone @ and malformed quoted tokens', () => {
  const references = extractAtFileReferences(
    '邮箱 test@example.com 不应命中，单独 @ 也不应命中，@"未闭合路径 和 @"" 也不算。',
  );

  assert.deepEqual(references, []);
});

test('extractAtFileReferences trims trailing sentence punctuation and wrapper brackets for unquoted refs', () => {
  assert.deepEqual(extractAtFileReferences('请看 @src/App.tsx。'), ['src/App.tsx']);
  assert.deepEqual(extractAtFileReferences('请看 @src/App.tsx, 然后继续'), ['src/App.tsx']);
  assert.deepEqual(extractAtFileReferences('请看 (@src/App.tsx)'), ['src/App.tsx']);
});

test('extractAtFileReferences keeps balanced bracket file names intact', () => {
  assert.deepEqual(extractAtFileReferences('请看 @src/file(v2).tsx'), ['src/file(v2).tsx']);
});

test('shouldSearchFileReferenceQuery requires the first search character', () => {
  assert.equal(shouldSearchFileReferenceQuery(''), false);
  assert.equal(shouldSearchFileReferenceQuery('   '), false);
  assert.equal(shouldSearchFileReferenceQuery('s'), true);
  assert.equal(shouldSearchFileReferenceQuery('/'), true);
});

test('empty @ query is blocked before frontend and backend search', () => {
  assert.match(composerSource, /!shouldSearchFileReferenceQuery\(activeFileReferenceToken\.query\)/);
  assert.match(serverSource, /if \(!normalizedQuery\) \{\s*return \[\];\s*\}/s);
});

test('@文件菜单和 slash 菜单一致：mousedown 只阻止失焦，click 再执行选择', () => {
  assert.match(composerSource, /onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(composerSource, /onClick=\{\(\) => applyFileReference\(file\)\}/);
  assert.match(composerSource, /setFileReferenceMenuDismissed\(true\);/);
});

test('@文件选择后的光标恢复改为延后同步，避免点击过程里直接强制 focus', () => {
  assert.match(composerSource, /const pendingSelectionRef = useRef<\{ start: number; end: number; restoreFocus: boolean \} \| null>\(null\);/);
  assert.match(composerSource, /const frameId = window\.requestAnimationFrame\(\(\) => \{/);
  assert.match(composerSource, /if \(latestSelection\.restoreFocus && document\.activeElement !== textarea\) \{/);
  assert.doesNotMatch(composerSource, /textarea\.focus\(\);\s*textarea\.setSelectionRange/);
});

test('@文件结果键盘移动时会把当前选中项滚动到可见区', () => {
  assert.match(composerSource, /const fileReferenceMenuRef = useRef<HTMLDivElement \| null>\(null\);/);
  assert.match(composerSource, /const fileReferenceItemRefs = useRef<Array<HTMLButtonElement \| null>>\(\[]\);/);
  assert.match(composerSource, /const container = fileReferenceMenuRef\.current;/);
  assert.match(composerSource, /const selectedItem = fileReferenceItemRefs\.current\[fileReferenceSelectedIndex\];/);
  assert.match(composerSource, /container\.scrollTop = Math\.max\(0, itemTop\);/);
  assert.match(composerSource, /container\.scrollTop = itemBottom - container\.clientHeight;/);
});

test('@文件结果优先复用工作台的丰富文件图标，加载失败时回退到 lucide 着色图标', () => {
  assert.match(composerSource, /import \{ getWorkbenchFileIconKind, resolveWorkbenchFileIcon \} from '\.\.\/lib\/workbench-files';/);
  assert.match(composerSource, /const iconSrc = resolveWorkbenchFileIcon\(path, isDirectory \? 'directory' : 'file'\);/);
  assert.match(composerSource, /onError=\{\(\) => setIconFailed\(true\)\}/);
  assert.match(composerSource, /const iconKind = getWorkbenchFileIconKind\(path, isDirectory \? 'directory' : 'file'\);/);
  assert.match(composerSource, /function getComposerFallbackIcon\(iconKind: string\): LucideIcon \{/);
  assert.match(composerSource, /composer-file-reference-icon-fallback composer-file-reference-icon-\$\{iconKind\}/);
});

test('Tauri CSP 允许从 jsdelivr 加载工作台同款 SVG 图标', () => {
  const tauriConfPath = new URL('../../src-tauri/tauri.conf.json', import.meta.url);
  const tauriConfig = readFileSync(tauriConfPath, 'utf8');
  assert.match(tauriConfig, /img-src[^"]*https:\/\/cdn\.jsdelivr\.net/);
});

test('server exposes a workspace-relative resolve endpoint distinct from fuzzy search', () => {
  // 修复点：搜索接口受深度/数量截断限制，无法稳定解析“@相对路径”，需要专门的 resolve 接口。
  assert.match(serverSource, /app\.get\('\/api\/system\/files\/resolve'/);
  assert.match(serverSource, /resolveWorkspaceRelativePath\(root,\s*rawPath\)/);
  assert.match(
    serverSource,
    /response\.json\(\{\s*path: resolved\.path,\s*rel: resolved\.rel,\s*isDirectory: stats\.isDirectory\(\),\s*\}\)/s,
  );
  assert.match(serverSource, /response\.status\(404\)\.send\('path 在 workspace 中不存在'\)/);
});

test('resolveWorkspaceRelativePath rejects absolute paths and parent traversal', () => {
  assert.match(serverSource, /if \(path\.isAbsolute\(stripped\)\) \{\s*return null;\s*\}/);
  assert.match(
    serverSource,
    /if \(slashed\.startsWith\('\.\.\/'\) \|\| slashed === '\.\.' \|\| slashed\.includes\('\/\.\.\/'\) \|\| slashed\.endsWith\('\/\.\.'\)\) \{/,
  );
  assert.match(serverSource, /if \(!relative \|\| relative\.startsWith\('\.\.'\) \|\| path\.isAbsolute\(relative\)\) \{/);
});

test('Composer @reference resolution uses the dedicated resolve endpoint instead of fuzzy search', () => {
  // 修复点：之前 findExistingRelativeFile 走 /files/search 再用完全相等过滤，
  // 受 ranking 和数量截断影响，深路径或截断后的文件解析不到。
  assert.match(composerSource, /\/api\/system\/files\/resolve\?\$\{params\.toString\(\)\}/);
  assert.match(composerSource, /path: reference,/);
  assert.doesNotMatch(composerSource, /\/api\/system\/files\/search\?\$\{params\.toString\(\)\}\)\s*[\r\n]+\s*if \(!response\.ok\) \{[\r\n]+\s*return null;[\r\n]+\s*\}\s*[\r\n]+\s*const payload = await response\.json\(\) as \{ files\?: FileReferenceSearchResult\[\] \}/);
});

test('searchWorkspaceFiles normalizes backslashes in user query before matching', () => {
  // 修复点：Windows 用户粘贴路径时常常带反斜杠（e.g. `@server\lib\workspace-store.ts`），
  // 而 rel 使用正斜杠存储，需要统一归一化。
  assert.match(serverSource, /function normalizeWorkspaceSearchQuery\(query: string\) \{\s*return query\.replace\(\/\\\\\/g,\s*'\/'\)\.toLowerCase\(\);\s*\}/s);
  assert.match(serverSource, /const normalizedQuery = normalizeWorkspaceSearchQuery\(query\);/);
});
