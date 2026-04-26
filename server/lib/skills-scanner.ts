import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export type SkillSummary = {
  id: string;
  name: string;
  description?: string;
  path: string;
  source: 'user' | 'plugin' | 'project' | 'system' | 'unknown';
};

export type SkillScanError = {
  path: string;
  message: string;
};

export type SkillsResponse = {
  skills: SkillSummary[];
  errors: SkillScanError[];
};

type SkillsScannerOptions = {
  homeDirectory?: string;
  projectDirectory?: string;
};

export function listSkills(options: SkillsScannerOptions = {}): SkillsResponse {
  const homeDirectory = options.homeDirectory || process.env.USERPROFILE || process.env.HOME || homedir();
  const roots = [
    { directory: path.join(homeDirectory, '.codex', 'skills'), source: 'user' as const },
    { directory: path.join(homeDirectory, '.codex', 'plugins', 'cache'), source: 'plugin' as const },
    ...(options.projectDirectory
      ? [{ directory: path.join(options.projectDirectory, '.codex', 'skills'), source: 'project' as const }]
      : []),
  ];

  const skills: SkillSummary[] = [];
  const errors: SkillScanError[] = [];

  for (const root of roots) {
    for (const skillPath of findSkillFiles(root.directory)) {
      try {
        skills.push(parseSkillFile(skillPath, root.source));
      } catch (error) {
        errors.push({
          path: skillPath,
          message: error instanceof Error ? error.message : '解析 Skill 失败',
        });
      }
    }
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return { skills, errors };
}

function findSkillFiles(root: string) {
  const result: string[] = [];
  if (!existsSync(root)) {
    return result;
  }

  walk(root, 0, result);
  return result;
}

function walk(directory: string, depth: number, result: string[]) {
  if (depth > 8) {
    return;
  }

  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === 'SKILL.md') {
      result.push(entryPath);
    } else if (entry.isDirectory()) {
      walk(entryPath, depth + 1, result);
    }
  }
}

function parseSkillFile(skillPath: string, source: SkillSummary['source']): SkillSummary {
  const content = readFileSync(skillPath, 'utf8');
  const frontmatter = parseFrontmatter(content);
  const name = frontmatter.name?.trim();
  if (!name) {
    throw new Error('Skill frontmatter 缺少 name');
  }

  const description = frontmatter.description?.trim();
  return {
    id: `${source}:${skillPath}`,
    name,
    description: description || undefined,
    path: skillPath,
    source,
  };
}

function parseFrontmatter(content: string) {
  if (!content.startsWith('---')) {
    return {};
  }

  const endIndex = content.indexOf('\n---', 3);
  if (endIndex === -1) {
    return {};
  }

  const frontmatter = content.slice(3, endIndex).trim();
  const result: Record<string, string> = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, '');
    if (key) {
      result[key] = value;
    }
  }
  return result;
}
