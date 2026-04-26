import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOpenTargetLaunch,
  discoverOpenTargets,
  parseOpenWithArgs,
  toWslPath,
} from './open-with.js';
import type { OpenWithSettings } from './settings-store.js';

const emptySettings: OpenWithSettings = {
  selectedTargetId: 'vscode',
  customTargets: [],
};

test('discoverOpenTargets orders built-in targets like the toolbar menu', () => {
  const targets = discoverOpenTargets(
    emptySettings,
    createResolver([
      'wt.exe',
      'code',
      'devenv',
      'cursor',
      'antigravity',
      'git-bash.exe',
      'wsl.exe',
      'idea64.exe',
      'rider64.exe',
      'pycharm64.exe',
      'webstorm64.exe',
    ]),
  );

  assert.deepEqual(
    targets.map((target) => target.id),
    [
      'vscode',
      'visualstudio',
      'cursor',
      'antigravity',
      'explorer',
      'terminal',
      'git-bash',
      'wsl',
      'idea',
      'rider',
      'pycharm',
      'webstorm',
    ],
  );
  assert.equal(targets.find((target) => target.id === 'terminal')?.command, 'wt.exe');
});

test('discoverOpenTargets falls terminal back to cmd when Windows Terminal is missing', () => {
  const targets = discoverOpenTargets(emptySettings, createResolver(['cmd.exe']));

  assert.equal(targets.find((target) => target.id === 'terminal')?.command, 'cmd.exe');
});

test('discoverOpenTargets includes custom targets with resolved command', () => {
  const targets = discoverOpenTargets(
    {
      selectedTargetId: 'custom-editor',
      customTargets: [
        {
          id: 'custom-editor',
          label: 'Custom Editor',
          kind: 'command',
          command: 'custom-editor',
          args: ['--reuse-window'],
        },
      ],
    },
    createResolver(['custom-editor']),
  );

  assert.deepEqual(targets.find((target) => target.id === 'custom-editor'), {
    id: 'custom-editor',
    label: 'Custom Editor',
    kind: 'command',
    command: 'custom-editor',
    args: ['--reuse-window'],
  });
});

test('buildOpenTargetLaunch opens folders and terminal with target-specific behavior', () => {
  assert.deepEqual(
    buildOpenTargetLaunch(
      { id: 'explorer', label: 'File Explorer', kind: 'explorer', command: 'explorer.exe', args: [] },
      'D:\\project\\codem',
    ),
    { command: 'explorer.exe', args: ['D:\\project\\codem'] },
  );

  assert.deepEqual(
    buildOpenTargetLaunch(
      { id: 'terminal', label: 'Terminal', kind: 'terminal', command: 'wt.exe', args: [] },
      'D:\\project\\codem',
    ),
    { command: 'wt.exe', args: ['-d', 'D:\\project\\codem'] },
  );

  assert.deepEqual(
    buildOpenTargetLaunch(
      { id: 'terminal', label: 'Terminal', kind: 'terminal', command: 'cmd.exe', args: [] },
      'D:\\project\\codem',
    ),
    { command: 'cmd.exe', args: ['/K', 'cd', '/d', 'D:\\project\\codem'] },
  );
});

test('buildOpenTargetLaunch opens editors, Git Bash and WSL in the project directory', () => {
  assert.deepEqual(
    buildOpenTargetLaunch(
      { id: 'vscode', label: 'VS Code', kind: 'app', command: 'code', args: [] },
      'D:\\project\\codem',
    ),
    { command: 'code', args: ['D:\\project\\codem'] },
  );

  assert.deepEqual(
    buildOpenTargetLaunch(
      { id: 'git-bash', label: 'Git Bash', kind: 'git-bash', command: 'git-bash.exe', args: [] },
      'D:\\project\\codem',
    ),
    { command: 'git-bash.exe', args: ['--cd=D:\\project\\codem'] },
  );

  assert.deepEqual(
    buildOpenTargetLaunch(
      { id: 'wsl', label: 'WSL', kind: 'wsl', command: 'wsl.exe', args: [] },
      'D:\\project\\codem',
    ),
    { command: 'wsl.exe', args: ['--cd', '/mnt/d/project/codem'] },
  );
});

test('parseOpenWithArgs tolerates empty and unterminated quoted args', () => {
  assert.deepEqual(parseOpenWithArgs(''), []);
  assert.deepEqual(parseOpenWithArgs('"--profile default'), ['--profile default']);
});

test('toWslPath converts Windows drive paths', () => {
  assert.equal(toWslPath('C:\\Users\\syscr\\project'), '/mnt/c/Users/syscr/project');
});

function createResolver(availableCommands: string[]) {
  const available = new Set(availableCommands.map((command) => command.toLowerCase()));
  return (command: string) => (available.has(command.toLowerCase()) ? command : '');
}
