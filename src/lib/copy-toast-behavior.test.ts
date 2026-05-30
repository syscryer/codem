import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const gitHistoryPanelSource = readFileSync(new URL('../components/GitHistoryPanel.tsx', import.meta.url), 'utf8');
const workspaceStateSource = readFileSync(new URL('../hooks/useWorkspaceState.ts', import.meta.url), 'utf8');

test('copy actions stay silent on success and only toast on failure', () => {
  const copyToClipboardBody = extractFunctionBody(gitHistoryPanelSource, 'copyToClipboard');
  const copySessionIdBody = extractFunctionBody(workspaceStateSource, 'handleCopySessionId');
  const copyProjectPathBody = extractFunctionBody(workspaceStateSource, 'handleCopyProjectPath');

  assert.doesNotMatch(copyToClipboardBody, /showToast\(successMessage\)/);
  assert.match(copyToClipboardBody, /showToast\('复制失败，请重试或手动复制。', 'error'\)/);

  assert.doesNotMatch(copySessionIdBody, /showToast\('会话 ID 已复制'\)/);
  assert.match(copySessionIdBody, /showToast\(`复制失败，请手动复制：\$\{thread\.sessionId\}`, 'error'\)/);

  assert.doesNotMatch(copyProjectPathBody, /showToast\('项目路径已复制'\)/);
  assert.match(copyProjectPathBody, /showToast\(`复制失败，请手动复制：\$\{project\.path\}`, 'error'\)/);
});

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
