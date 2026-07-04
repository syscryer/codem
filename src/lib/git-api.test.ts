import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addGitFilesToIndex,
  abortGitOperation,
  checkoutGitDetachedRef,
  cherryPickGitCommit,
  continueGitOperation,
  createGitTag,
  deleteGitBranch,
  fetchGitConflictFile,
  fetchGitOperationState,
  markGitConflictResolved,
  pullGitBranch,
  pushGitBranch,
  revertGitFileChange,
  revertGitFileChanges,
  saveGitConflictResult,
} from './git-api.js';

test('createGitTag posts the tag name and source ref', async () => {
  const fetchCalls = mockFetch({ output: 'tagged', summary: {}, tag: 'v1.0.0' });

  await createGitTag('project-1', 'v1.0.0', 'abc123');

  assert.deepEqual(fetchCalls[0], {
    url: '/api/projects/project-1/git/tag',
    method: 'POST',
    body: { tag: 'v1.0.0', source: 'abc123' },
  });
});

test('cherryPickGitCommit posts the selected commit sha', async () => {
  const fetchCalls = mockFetch({ output: 'picked', summary: {} });

  await cherryPickGitCommit('project-1', 'abc123');

  assert.deepEqual(fetchCalls[0], {
    url: '/api/projects/project-1/git/cherry-pick',
    method: 'POST',
    body: { sha: 'abc123' },
  });
});

test('checkoutGitDetachedRef posts the target ref', async () => {
  const fetchCalls = mockFetch({ output: 'detached', summary: {} });

  await checkoutGitDetachedRef('project-1', 'abc123');

  assert.deepEqual(fetchCalls[0], {
    url: '/api/projects/project-1/git/checkout-detached',
    method: 'POST',
    body: { ref: 'abc123' },
  });
});

test('deleteGitBranch posts local and remote branch metadata', async () => {
  const fetchCalls = mockFetch({ output: 'deleted', summary: {} });

  await deleteGitBranch('project-1', { name: 'origin/feature/menu', remoteName: 'origin' });

  assert.deepEqual(fetchCalls[0], {
    url: '/api/projects/project-1/git/branch/delete',
    method: 'POST',
    body: { branch: 'origin/feature/menu', remote: 'origin' },
  });
});

test('pullGitBranch posts the selected remote and branch', async () => {
  const fetchCalls = mockFetch({ output: 'pulled', summary: {} });

  await pullGitBranch('project-1', 'origin', 'main', 'rebase');

  assert.deepEqual(fetchCalls[0], {
    url: '/api/projects/project-1/git/pull',
    method: 'POST',
    body: { remote: 'origin', branch: 'main', mode: 'rebase' },
  });
});

test('pushGitBranch posts the selected remote and branch', async () => {
  const fetchCalls = mockFetch({ output: 'pushed', summary: {} });

  await pushGitBranch('project-1', 'origin', 'main');

  assert.deepEqual(fetchCalls[0], {
    url: '/api/projects/project-1/git/push',
    method: 'POST',
    body: { remote: 'origin', branch: 'main' },
  });
});

test('revertGitFileChange posts the target file path', async () => {
  const fetchCalls = mockFetch({ paths: ['src/App.tsx'], reverted: ['src/App.tsx'], deleted: [], summary: {} });

  await revertGitFileChange('project-1', 'src/App.tsx');

  assert.deepEqual(fetchCalls[0], {
    url: '/api/projects/project-1/git/revert-file',
    method: 'POST',
    body: { paths: ['src/App.tsx'] },
  });
});

test('revertGitFileChanges posts multiple target file paths', async () => {
  const fetchCalls = mockFetch({ paths: ['src/App.tsx', 'src/types.ts'], reverted: [], deleted: [], summary: {} });

  await revertGitFileChanges('project-1', ['src/App.tsx', 'src/types.ts']);

  assert.deepEqual(fetchCalls[0], {
    url: '/api/projects/project-1/git/revert-file',
    method: 'POST',
    body: { paths: ['src/App.tsx', 'src/types.ts'] },
  });
});

test('addGitFilesToIndex posts target file paths', async () => {
  const fetchCalls = mockFetch({ added: ['src/App.tsx', 'src/types.ts'], summary: {} });

  await addGitFilesToIndex('project-1', ['src/App.tsx', 'src/types.ts']);

  assert.deepEqual(fetchCalls[0], {
    url: '/api/projects/project-1/git/add-files',
    method: 'POST',
    body: { paths: ['src/App.tsx', 'src/types.ts'] },
  });
});

test('Git conflict APIs call stable operation-state endpoints', async () => {
  const fetchCalls = mockFetch({
    status: 'conflicted',
    operation: 'merge',
    hasConflicts: true,
    conflicts: [],
  });

  await fetchGitOperationState('project-1');
  await fetchGitConflictFile('project-1', 'src/App.tsx');
  await saveGitConflictResult('project-1', 'src/App.tsx', 'resolved\n');
  await markGitConflictResolved('project-1', 'src/App.tsx');
  await continueGitOperation('project-1');
  await abortGitOperation('project-1');

  assert.deepEqual(fetchCalls, [
    {
      url: '/api/projects/project-1/git/operation-state',
      method: 'GET',
      body: undefined,
    },
    {
      url: '/api/projects/project-1/git/conflicts/file?path=src%2FApp.tsx',
      method: 'GET',
      body: undefined,
    },
    {
      url: '/api/projects/project-1/git/conflicts/save-result',
      method: 'POST',
      body: { path: 'src/App.tsx', content: 'resolved\n' },
    },
    {
      url: '/api/projects/project-1/git/conflicts/mark-resolved',
      method: 'POST',
      body: { path: 'src/App.tsx' },
    },
    {
      url: '/api/projects/project-1/git/operation/continue',
      method: 'POST',
      body: undefined,
    },
    {
      url: '/api/projects/project-1/git/operation/abort',
      method: 'POST',
      body: undefined,
    },
  ]);
});

function mockFetch(payload: unknown) {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return {
      ok: true,
      json: async () => payload,
      text: async () => '',
    } as Response;
  }) as typeof fetch;

  test.after(() => {
    globalThis.fetch = originalFetch;
  });

  return calls;
}
