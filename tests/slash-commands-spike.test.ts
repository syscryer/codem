import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const scriptPath = path.resolve('scripts/slash-commands-spike.mjs');

function withTemporaryWorkspace(callback: (workspace: {
  homeDirectory: string;
  appDataDirectory: string;
  projectDirectory: string;
}) => void) {
  const rootDirectory = mkdtempSync(path.join(tmpdir(), 'codem-slash-spike-'));
  const workspace = {
    homeDirectory: path.join(rootDirectory, 'home'),
    appDataDirectory: path.join(rootDirectory, 'app-data'),
    projectDirectory: path.join(rootDirectory, 'project'),
  };

  try {
    mkdirSync(path.join(workspace.homeDirectory, '.codex', 'skills', 'brainstorming'), { recursive: true });
    writeFileSync(
      path.join(workspace.homeDirectory, '.codex', 'skills', 'brainstorming', 'SKILL.md'),
      [
        '---',
        'name: brainstorming',
        'description: Structured design exploration',
        '---',
        '# Brainstorming',
      ].join('\n'),
      'utf8',
    );
    callback(workspace);
  } finally {
    rmSync(rootDirectory, { recursive: true, force: true });
  }
}

function runSpike(workspace: {
  homeDirectory: string;
  appDataDirectory: string;
  projectDirectory: string;
}, extraArgs: string[] = []) {
  return spawnSync(
    process.execPath,
    [
      scriptPath,
      '--project',
      workspace.projectDirectory,
      '--home',
      workspace.homeDirectory,
      '--app-data',
      workspace.appDataDirectory,
      ...extraArgs,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );
}

test('slash command spike prints JSON payload when --json is provided', () => {
  withTemporaryWorkspace((workspace) => {
    const result = runSpike(workspace, ['--json']);

    assert.equal(result.status, 0);
    assert.equal(result.stderr.trim(), '');

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.projectDirectory, path.resolve(workspace.projectDirectory));
    assert.equal(payload.summary.total, 16);
    assert.equal(payload.summary.bySource.builtin, 13);
    assert.equal(payload.summary.bySource.app, 2);
    assert.equal(payload.summary.bySource.skill, 1);
    assert.ok(payload.commands.some((command: { slash: string }) => command.slash === '/compact'));
    assert.ok(payload.commands.some((command: { slash: string }) => command.slash === '/clear'));
    assert.ok(payload.commands.some((command: { slash: string }) => command.slash === '/brainstorming'));
  });
});

test('slash command spike keeps human-readable grouped output by default', () => {
  withTemporaryWorkspace((workspace) => {
    const result = runSpike(workspace);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Slash command spike for:/);
    assert.match(result.stdout, /\[builtin\]\s+13/);
    assert.match(result.stdout, /\[app\]\s+2/);
    assert.match(result.stdout, /\/compact \| action=local-action/);
    assert.match(result.stdout, /\/clear \| action=local-action/);
  });
});

test('slash command spike succeeds in --assert mode for required commands', () => {
  withTemporaryWorkspace((workspace) => {
    const result = runSpike(workspace, ['--assert', '--require', '/help']);

    assert.equal(result.status, 0);
    assert.match(result.stderr, /Slash command assertions passed\./);
  });
});

test('slash command spike exits non-zero when required commands are missing', () => {
  withTemporaryWorkspace((workspace) => {
    const result = runSpike(workspace, ['--assert', '--require', '/missing-command']);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing required slash command: \/missing-command/);
  });
});
