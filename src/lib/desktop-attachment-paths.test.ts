import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  dedupeAndValidateDesktopPaths,
  getDesktopPathBasename,
  isDesktopImagePath,
  normalizeDesktopPathForComparison,
  validateDesktopFilePath,
} from './desktop-attachment-paths.js';

test('validateDesktopFilePath rejects traversal and sensitive paths', () => {
  assert.equal(validateDesktopFilePath('I:\\安装包\\redis\\redis.txt'), 'I:\\安装包\\redis\\redis.txt');
  assert.equal(validateDesktopFilePath('  '), null);
  assert.equal(validateDesktopFilePath('../secret/passwd'), null);
  assert.equal(validateDesktopFilePath('/home/user/project/../../etc/passwd'), null);
  assert.equal(validateDesktopFilePath('C:\\Users\\me\\.ssh\\id_rsa'), null);
  assert.equal(validateDesktopFilePath('C:\\Users\\me\\.aws\\credentials'), null);
  assert.equal(validateDesktopFilePath('/home/me/project/.env'), null);
  assert.equal(validateDesktopFilePath('/home/me/project/.env.local'), null);
});

test('validateDesktopFilePath keeps normal env-like names that are not dotenv files', () => {
  assert.equal(
    validateDesktopFilePath('/home/me/project/environment.ts'),
    '/home/me/project/environment.ts',
  );
});

test('normalizeDesktopPathForComparison unifies separators and lowercases drive letter', () => {
  assert.equal(
    normalizeDesktopPathForComparison('I:\\安装包\\Redis.TXT'),
    'i:/安装包/Redis.TXT',
  );
  assert.equal(
    normalizeDesktopPathForComparison('C:/Users/me/file.md'),
    'c:/Users/me/file.md',
  );
});

test('dedupeAndValidateDesktopPaths removes duplicates and invalid entries', () => {
  const result = dedupeAndValidateDesktopPaths([
    'I:\\pkg\\a.txt',
    'I:/pkg/a.txt', // 与上一条等价，去重
    'C:\\Users\\me\\.ssh\\key', // 敏感，剔除
    '   ', // 空，剔除
    'D:\\docs\\b.pdf',
  ]);

  assert.deepEqual(result, ['I:\\pkg\\a.txt', 'D:\\docs\\b.pdf']);
});

test('getDesktopPathBasename extracts the file name from both separators', () => {
  assert.equal(getDesktopPathBasename('I:\\安装包\\redis\\redis-6.2.1.txt'), 'redis-6.2.1.txt');
  assert.equal(getDesktopPathBasename('/home/me/notes/todo.md'), 'todo.md');
});

test('isDesktopImagePath only treats multimodal-friendly raster images as images', () => {
  assert.equal(isDesktopImagePath('C:\\pics\\shot.PNG'), true);
  assert.equal(isDesktopImagePath('C:\\pics\\photo.jpeg'), true);
  assert.equal(isDesktopImagePath('C:\\pics\\anim.gif'), true);
  assert.equal(isDesktopImagePath('C:\\pics\\pic.webp'), true);
  assert.equal(isDesktopImagePath('C:\\pics\\icon.svg'), false);
  assert.equal(isDesktopImagePath('C:\\docs\\readme.md'), false);
});
