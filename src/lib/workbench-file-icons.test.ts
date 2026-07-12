import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getWorkbenchFileIconKind,
  resolveWorkbenchFileIconDescriptor,
} from './workbench-file-icons';

test('local workbench icons cover common programming languages and frameworks', () => {
  const cases = [
    ['src/App.tsx', 'react'],
    ['src/main.ts', 'typescript'],
    ['src/main.js', 'javascript'],
    ['src/App.vue', 'vue'],
    ['src/App.svelte', 'svelte'],
    ['src/main.rs', 'rust'],
    ['src/main.go', 'go'],
    ['src/main.py', 'python'],
    ['src/Main.java', 'java'],
    ['src/Main.kt', 'kotlin'],
    ['src/App.swift', 'swift'],
    ['src/main.cs', 'csharp'],
    ['src/main.cpp', 'cpp'],
    ['src/main.rb', 'ruby'],
    ['src/main.php', 'php'],
    ['src/main.dart', 'dart'],
    ['src/schema.graphql', 'graphql'],
    ['src/App.astro', 'astro'],
  ] as const;

  for (const [path, kind] of cases) {
    assert.equal(getWorkbenchFileIconKind(path, 'file'), kind, path);
  }
});

test('local workbench icons cover project metadata, assets, archives, and binaries', () => {
  const cases = [
    ['Dockerfile', 'docker'],
    ['deploy/api.Dockerfile', 'docker'],
    ['docker-compose.yml', 'docker'],
    ['package.json', 'node'],
    ['package-lock.json', 'lock'],
    ['Cargo.toml', 'rust'],
    ['Cargo.lock', 'lock'],
    ['go.mod', 'go'],
    ['pyproject.toml', 'python'],
    ['vite.config.ts', 'config'],
    ['src/app.test.ts', 'test'],
    ['src/Button.stories.tsx', 'test'],
    ['.env.production', 'config'],
    ['README.zh-CN.md', 'readme'],
    ['LICENSE.txt', 'license'],
    ['db/schema.sql', 'sql'],
    ['data/report.xlsx', 'excel'],
    ['assets/logo.svg', 'image'],
    ['docs/spec.pdf', 'document'],
    ['media/song.mp3', 'audio'],
    ['media/demo.mp4', 'video'],
    ['archive/app.zip', 'archive'],
    ['certs/server.pem', 'certificate'],
    ['fonts/inter.woff2', 'font'],
    ['dist/app.exe', 'executable'],
    ['dist/module.wasm', 'wasm'],
  ] as const;

  for (const [path, kind] of cases) {
    assert.equal(getWorkbenchFileIconKind(path, 'file'), kind, path);
  }
});

test('directory icons use local descriptors for common workspace folders', () => {
  const source = resolveWorkbenchFileIconDescriptor('src', 'directory');
  const git = resolveWorkbenchFileIconDescriptor('.git', 'directory');
  const modules = resolveWorkbenchFileIconDescriptor('node_modules', 'directory');
  const unknown = resolveWorkbenchFileIconDescriptor('custom-folder', 'directory');

  assert.equal(source.shape, 'folder');
  assert.equal(git.shape, 'folder');
  assert.equal(modules.shape, 'folder');
  assert.equal(unknown.shape, 'folder');
  assert.notEqual(source.accent, git.accent);
  assert.notEqual(modules.accent, unknown.accent);
});

test('unknown files keep a stable local default without network URLs', () => {
  const icon = resolveWorkbenchFileIconDescriptor('data/unknown.custom-extension', 'file');

  assert.equal(icon.kind, 'file');
  assert.equal(icon.shape, 'file');
  assert.doesNotMatch(JSON.stringify(icon), /https?:\/\//);
});
