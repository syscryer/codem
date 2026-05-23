import assert from 'node:assert/strict';
import test from 'node:test';

import { filterGitHistorySearchableOptions } from './git-history-searchable-select';

test('filterGitHistorySearchableOptions 在空关键字时返回全部选项', () => {
  const options = [
    { value: 'main', label: '本地 · main' },
    { value: 'origin/main', label: '远程 · origin/main' },
  ];

  assert.deepEqual(filterGitHistorySearchableOptions(options, ''), options);
});

test('filterGitHistorySearchableOptions 支持按标签文本匹配', () => {
  const options = [
    { value: 'main', label: '本地 · main' },
    { value: 'origin/main', label: '远程 · origin/main' },
    { value: 'release/v1.0.0', label: '标签 · release/v1.0.0' },
  ];

  assert.deepEqual(filterGitHistorySearchableOptions(options, '标签'), [
    { value: 'release/v1.0.0', label: '标签 · release/v1.0.0' },
  ]);
});

test('filterGitHistorySearchableOptions 支持按值与标签的混合文本匹配', () => {
  const options = [
    { value: 'Alice Chen', label: 'Alice Chen' },
    { value: 'Bob Li', label: 'Bob Li' },
    { value: 'feature/CNTD-7584', label: '本地 · feature/CNTD-7584' },
  ];

  assert.deepEqual(filterGitHistorySearchableOptions(options, '7584'), [
    { value: 'feature/CNTD-7584', label: '本地 · feature/CNTD-7584' },
  ]);
  assert.deepEqual(filterGitHistorySearchableOptions(options, 'bob'), [
    { value: 'Bob Li', label: 'Bob Li' },
  ]);
});
