import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export type InstalledPlugin = {
  id: string;
  name: string;
  marketplace: string;
  version?: string;
  scope: string;
  installPath?: string;
  projectPath?: string;
  installedAt?: string;
  lastUpdated?: string;
  description?: string;
  author?: string;
  homepage?: string;
  category?: string;
};

export type MarketplacePlugin = {
  name: string;
  description?: string;
  author?: string;
  homepage?: string;
  category?: string;
};

export type Marketplace = {
  name: string;
  source?: string;
  installLocation?: string;
  lastUpdated?: string;
  plugins: MarketplacePlugin[];
};

export type SkillSource = 'user' | 'project' | `plugin:${string}`;

export type Skill = {
  name: string;
  description?: string;
  source: SkillSource;
  path: string;
  disableModelInvocation: boolean;
  userInvocable: boolean;
};

export type SkillInstallEntry = {
  name: string;
  path: string;
};

export type SkillInstallResult = {
  installed: SkillInstallEntry[];
};

export type PluginCommandArgs = {
  action: string;
  kind: 'marketplace' | 'plugin';
  target?: string | null;
  scope?: string | null;
  cwd?: string | null;
};

export type PluginCommandResult = {
  stdout: string;
  stderr: string;
  exit_code: number;
  command?: string;
  args?: string[];
  cwd?: string | null;
};

type PluginServiceOptions = {
  homeDirectory?: string;
  commandRunner?: CommandRunner;
};

type InstallSkillArgs = {
  path?: string;
  scope?: string;
  cwd?: string | null;
  overwrite?: boolean;
};

type BuiltinSkillArgs = {
  id?: string;
  cwd?: string | null;
};

type MarketplaceIndex = Map<string, MarketplacePlugin[]>;

type CommandRunner = (
  command: string,
  args: string[],
  options: { cwd?: string | null },
) => Promise<{
  command?: string;
  args?: string[];
  cwd?: string | null;
  stdout: string;
  stderr: string;
  exitCode: number;
}>;

export async function listInstalledPlugins(options: PluginServiceOptions = {}): Promise<InstalledPlugin[]> {
  const pluginsRoot = getPluginsRoot(options.homeDirectory);
  const payload = readJsonFile(path.join(pluginsRoot, 'installed_plugins.json'));
  const entries = asRecord(payload?.plugins);
  const marketplaceIndex = buildMarketplaceIndex(options.homeDirectory);
  const items: InstalledPlugin[] = [];

  for (const [pluginId, rawInstallations] of Object.entries(entries)) {
    const installations = Array.isArray(rawInstallations) ? rawInstallations : [];
    const [name, marketplace] = splitPluginId(pluginId);
    const metadata = (marketplaceIndex.get(marketplace) ?? []).find((item) => item.name === name);

    for (const installation of installations) {
      const details = asRecord(installation);
      items.push({
        id: pluginId,
        name,
        marketplace,
        version: readString(details.version),
        scope: readString(details.scope) ?? 'user',
        installPath: readString(details.installPath),
        projectPath: readString(details.projectPath),
        installedAt: readString(details.installedAt),
        lastUpdated: readString(details.lastUpdated),
        description: metadata?.description,
        author: metadata?.author,
        homepage: metadata?.homepage,
        category: metadata?.category,
      });
    }
  }

  items.sort((left, right) => {
    const nameDelta = left.name.localeCompare(right.name);
    if (nameDelta !== 0) {
      return nameDelta;
    }
    return left.scope.localeCompare(right.scope);
  });
  return items;
}

export async function listMarketplaces(options: PluginServiceOptions = {}): Promise<Marketplace[]> {
  const pluginsRoot = getPluginsRoot(options.homeDirectory);
  const payload = readJsonFile(path.join(pluginsRoot, 'known_marketplaces.json'));
  const entries = asRecord(payload);
  const marketplaces: Marketplace[] = [];

  for (const [name, rawMeta] of Object.entries(entries)) {
    const meta = asRecord(rawMeta);
    marketplaces.push({
      name,
      source: readString(asRecord(meta.source).repo) ?? readString(asRecord(meta.source).url),
      installLocation: readString(meta.installLocation),
      lastUpdated: readString(meta.lastUpdated),
      plugins: readMarketplacePlugins(options.homeDirectory, name),
    });
  }

  marketplaces.sort((left, right) => left.name.localeCompare(right.name));
  return marketplaces;
}

export async function listSkills(cwd: string | null, options: PluginServiceOptions = {}): Promise<Skill[]> {
  const homeDirectory = resolveHomeDirectory(options.homeDirectory);
  const skills: Skill[] = [];

  scanSkillDirectory(path.join(homeDirectory, '.claude', 'skills'), 'user', skills);

  if (cwd) {
    scanSkillDirectory(path.join(path.resolve(cwd), '.claude', 'skills'), 'project', skills);
  }

  const cacheRoot = path.join(homeDirectory, '.claude', 'plugins', 'cache');
  if (existsSync(cacheRoot)) {
    for (const marketplaceEntry of safeReadDir(cacheRoot)) {
      if (!marketplaceEntry.isDirectory()) {
        continue;
      }
      const marketplaceName = marketplaceEntry.name;
      const marketplacePath = path.join(cacheRoot, marketplaceName);
      for (const pluginEntry of safeReadDir(marketplacePath)) {
        if (!pluginEntry.isDirectory()) {
          continue;
        }
        const pluginName = pluginEntry.name;
        const pluginPath = path.join(marketplacePath, pluginName);
        for (const versionEntry of safeReadDir(pluginPath)) {
          if (!versionEntry.isDirectory()) {
            continue;
          }
          scanSkillDirectory(
            path.join(pluginPath, versionEntry.name, 'skills'),
            `plugin:${pluginName}@${marketplaceName}`,
            skills,
          );
        }
      }
    }
  }

  skills.sort((left, right) => left.name.localeCompare(right.name));
  return skills;
}

export async function installSkillFromPath(
  rawArgs: InstallSkillArgs,
  options: PluginServiceOptions = {},
): Promise<SkillInstallResult> {
  const sourcePath = rawArgs.path ? path.resolve(rawArgs.path) : '';
  if (!sourcePath || !existsSync(sourcePath) || !statSync(sourcePath).isDirectory()) {
    throw new Error('Skill 来源目录不存在');
  }

  const targetRoot = resolveSkillInstallRoot(rawArgs.scope, rawArgs.cwd, options.homeDirectory);
  const skillDirectories = collectSkillSourceDirectories(sourcePath);
  const installed: SkillInstallEntry[] = [];

  mkdirSync(targetRoot, { recursive: true });

  for (const directory of skillDirectories) {
    const parsed = parseSkillMarkdown(path.join(directory, 'SKILL.md'));
    const name = sanitizeSkillDirectoryName(parsed.name);
    const targetDirectory = path.join(targetRoot, name);

    if (existsSync(targetDirectory)) {
      if (!rawArgs.overwrite) {
        throw new Error(`Skill 已存在：${name}`);
      }
      rmSync(targetDirectory, { recursive: true, force: true });
    }

    copyDirectory(directory, targetDirectory);
    installed.push({ name, path: targetDirectory });
  }

  return { installed };
}

export async function installBuiltinSkill(
  rawArgs: BuiltinSkillArgs,
  options: PluginServiceOptions = {},
): Promise<PluginCommandResult> {
  const builtinId = rawArgs.id?.trim();
  if (builtinId !== 'playwright-cli') {
    throw new Error(`未知内置 Skill：${builtinId || 'unknown'}`);
  }

  const installDirectory = rawArgs.cwd?.trim() ? path.resolve(rawArgs.cwd) : resolveHomeDirectory(options.homeDirectory);
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const args = ['--yes', '--package', '@playwright/cli@latest', 'playwright-cli', 'install', '--skills'];

  const result = await runCommand(command, args, { cwd: installDirectory }, options.commandRunner);
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exitCode,
    command: result.command ?? command,
    args: result.args ?? args,
    cwd: result.cwd ?? installDirectory,
  };
}

export async function runPluginCommand(
  args: PluginCommandArgs,
  options: PluginServiceOptions = {},
): Promise<PluginCommandResult> {
  const command = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const commandArgs = buildPluginCommandArgs(args);
  const result = await runCommand(command, commandArgs, { cwd: args.cwd ?? null }, options.commandRunner);

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exitCode,
    command: stripExecutableExtension(result.command ?? command),
    args: result.args ?? commandArgs,
    cwd: result.cwd ?? args.cwd ?? null,
  };
}

function buildPluginCommandArgs(args: PluginCommandArgs) {
  const commandArgs = ['plugin'];

  if (args.kind === 'marketplace') {
    commandArgs.push('marketplace', args.action);
    if (args.target?.trim()) {
      commandArgs.push(args.target.trim());
    }
    return commandArgs;
  }

  commandArgs.push(args.action);
  if (args.target?.trim()) {
    commandArgs.push(args.target.trim());
  }
  if (args.scope?.trim()) {
    commandArgs.push('--scope', args.scope.trim());
  }

  return commandArgs;
}

async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string | null },
  commandRunner?: CommandRunner,
) {
  if (commandRunner) {
    return commandRunner(command, args, options);
  }

  return new Promise<{
    command: string;
    args: string[];
    cwd?: string | null;
    stdout: string;
    stderr: string;
    exitCode: number;
  }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        command,
        args,
        cwd: options.cwd ?? null,
        stdout,
        stderr,
        exitCode: code ?? -1,
      });
    });
  });
}

function getPluginsRoot(homeDirectory?: string) {
  return path.join(resolveHomeDirectory(homeDirectory), '.claude', 'plugins');
}

function resolveHomeDirectory(homeDirectory?: string) {
  return homeDirectory || process.env.USERPROFILE || process.env.HOME || homedir();
}

function buildMarketplaceIndex(homeDirectory?: string): MarketplaceIndex {
  const index = new Map<string, MarketplacePlugin[]>();
  for (const marketplace of safeReadDir(path.join(getPluginsRoot(homeDirectory), 'marketplaces'))) {
    if (!marketplace.isDirectory()) {
      continue;
    }
    index.set(marketplace.name, readMarketplacePlugins(homeDirectory, marketplace.name));
  }
  return index;
}

function readMarketplacePlugins(homeDirectory: string | undefined, name: string): MarketplacePlugin[] {
  const payload = readJsonFile(
    path.join(getPluginsRoot(homeDirectory), 'marketplaces', name, '.claude-plugin', 'marketplace.json'),
  );
  const rawPlugins = Array.isArray(payload?.plugins) ? payload.plugins : [];
  const plugins: MarketplacePlugin[] = [];

  for (const entry of rawPlugins) {
    const item = asRecord(entry);
    const pluginName = readString(item.name);
    if (!pluginName) {
      continue;
    }

    plugins.push({
      name: pluginName,
      description: readString(item.description),
      author: readString(asRecord(item.author).name),
      homepage: readString(item.homepage),
      category: readString(item.category),
    });
  }

  return plugins.sort((left, right) => left.name.localeCompare(right.name));
}

function readJsonFile(filePath: string) {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function splitPluginId(pluginId: string) {
  const [name, marketplace = ''] = pluginId.split('@');
  return [name, marketplace] as const;
}

function parseSkillMarkdown(skillPath: string) {
  const raw = readFileSync(skillPath, 'utf8');
  const directoryName = path.basename(path.dirname(skillPath));

  if (!raw.trimStart().startsWith('---')) {
    return {
      name: directoryName,
      description: undefined,
      disableModelInvocation: false,
      userInvocable: true,
    };
  }

  const body = raw.trimStart().slice(3);
  const endIndex = body.search(/\r?\n---/);
  if (endIndex === -1) {
    return {
      name: directoryName,
      description: undefined,
      disableModelInvocation: false,
      userInvocable: true,
    };
  }

  const frontmatter = body.slice(0, endIndex);
  let name = directoryName;
  let description: string | undefined;
  let disableModelInvocation = false;
  let userInvocable = true;
  let currentKey = '';

  for (const rawLine of frontmatter.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      continue;
    }

    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      if (currentKey === 'description' && description) {
        description = `${description} ${line.trim()}`.trim();
      }
      continue;
    }

    currentKey = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^["']|["']$/g, '');

    if (currentKey === 'name' && value) {
      name = value;
      continue;
    }
    if (currentKey === 'description') {
      description = value || undefined;
      continue;
    }
    if (currentKey === 'disable-model-invocation') {
      disableModelInvocation = value.toLowerCase() === 'true';
      continue;
    }
    if (currentKey === 'user-invocable') {
      userInvocable = value.toLowerCase() !== 'false';
    }
  }

  return {
    name,
    description,
    disableModelInvocation,
    userInvocable,
  };
}

function scanSkillDirectory(root: string, source: SkillSource, skills: Skill[]) {
  if (!existsSync(root)) {
    return;
  }

  for (const entry of safeReadDir(root)) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillPath = path.join(root, entry.name, 'SKILL.md');
    if (!existsSync(skillPath)) {
      continue;
    }

    const parsed = parseSkillMarkdown(skillPath);
    skills.push({
      name: parsed.name,
      description: parsed.description,
      source,
      path: skillPath,
      disableModelInvocation: parsed.disableModelInvocation,
      userInvocable: parsed.userInvocable,
    });
  }
}

function resolveSkillInstallRoot(scope: string | undefined, cwd: string | null | undefined, homeDirectory?: string) {
  if (scope === 'project') {
    if (!cwd?.trim()) {
      throw new Error('project scope 需要 cwd');
    }
    return path.join(path.resolve(cwd), '.claude', 'skills');
  }

  return path.join(resolveHomeDirectory(homeDirectory), '.claude', 'skills');
}

function collectSkillSourceDirectories(sourcePath: string) {
  const skillFile = path.join(sourcePath, 'SKILL.md');
  if (existsSync(skillFile)) {
    return [sourcePath];
  }

  return safeReadDir(sourcePath)
    .filter((entry) => entry.isDirectory() && existsSync(path.join(sourcePath, entry.name, 'SKILL.md')))
    .map((entry) => path.join(sourcePath, entry.name));
}

function sanitizeSkillDirectoryName(value: string) {
  const sanitized = value.trim();
  if (!sanitized || /[\\/:*?"<>|]/.test(sanitized)) {
    throw new Error(`非法 Skill 名称：${value}`);
  }
  return sanitized;
}

function copyDirectory(source: string, target: string) {
  mkdirSync(target, { recursive: true });
  for (const entry of safeReadDir(source)) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
      continue;
    }
    copyFileSync(sourcePath, targetPath);
  }
}

function safeReadDir(directory: string) {
  try {
    return readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

function stripExecutableExtension(command: string) {
  return command.replace(/\.exe$/i, '');
}
