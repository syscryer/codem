import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { listSkills } from './skills-scanner.js';

function withTemporaryDirectory<T>(callback: (directory: string) => T): T {
  const directory = mkdtempSync(path.join(tmpdir(), 'codem-skills-'));
  try {
    return callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('listSkills parses user skill frontmatter', () => {
  withTemporaryDirectory((homeDirectory) => {
    const skillDirectory = path.join(homeDirectory, '.codex', 'skills', 'writer');
    mkdirSync(skillDirectory, { recursive: true });
    writeFileSync(
      path.join(skillDirectory, 'SKILL.md'),
      '---\nname: writer\ndescription: Writes clearly\n---\n# Writer\n',
      'utf8',
    );

    const result = listSkills({ homeDirectory });

    assert.equal(result.skills.length, 1);
    assert.equal(result.skills[0].name, 'writer');
    assert.equal(result.skills[0].description, 'Writes clearly');
    assert.equal(result.skills[0].source, 'user');
  });
});

test('listSkills tolerates missing description and invalid frontmatter', () => {
  withTemporaryDirectory((homeDirectory) => {
    const validDirectory = path.join(homeDirectory, '.codex', 'plugins', 'cache', 'plugin-a', 'skills', 'runner');
    const invalidDirectory = path.join(homeDirectory, '.codex', 'skills', 'broken');
    mkdirSync(validDirectory, { recursive: true });
    mkdirSync(invalidDirectory, { recursive: true });
    writeFileSync(path.join(validDirectory, 'SKILL.md'), '---\nname: runner\n---\n# Runner\n', 'utf8');
    writeFileSync(path.join(invalidDirectory, 'SKILL.md'), '---\ndescription: Missing name\n---\n', 'utf8');

    const result = listSkills({ homeDirectory });

    assert.equal(result.skills.length, 1);
    assert.equal(result.skills[0].name, 'runner');
    assert.equal(result.skills[0].source, 'plugin');
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].message, /缺少 name/);
  });
});
