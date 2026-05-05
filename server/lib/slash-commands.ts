import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { listMcpServers } from './mcp-inspector.js';
import { listSkills, type SkillSummary } from './skills-scanner.js';

export type SlashCommandSource =
  | 'builtin'
  | 'project'
  | 'user'
  | 'plugin'
  | 'skill'
  | 'mcp'
  | 'app';

export type SlashCommandAction = 'passthrough' | 'insert-template' | 'local-action';
export type SlashAgent = 'claude' | 'codex' | 'gemini' | 'opencode';

// 业务分类:菜单分组与图标按 category 走;source 仅用于来源去重和 UI 标签
export type SlashCommandCategory =
  | 'session'
  | 'context'
  | 'system'
  | 'git'
  | 'config'
  | 'workflow'
  | 'tooling'
  | 'custom'
  | 'plugin';

export type SlashCommand = {
  id: string;
  name: string;
  slash: string;
  title: string;
  description?: string;
  source: SlashCommandSource;
  action: SlashCommandAction;
  template?: string;
  argumentHint?: string;
  sourceLabel?: string;
  localActionId?: string;
  category?: SlashCommandCategory;
  agentScope: SlashAgent[];
  // 是否支持 -p / stream-json 非交互模式;false 的内置命令暂不暴露,避免假 passthrough
  supportsNonInteractive?: boolean;
};

type SlashCommandContext = {
  homeDirectory?: string;
  projectDirectory?: string;
  appDataDirectory?: string;
};

type MarkdownCommandSource = {
  directory: string;
  source: Extract<SlashCommandSource, 'project' | 'user' | 'plugin'>;
  sourceLabel?: string;
  namespace?: string;
};

type MarkdownFrontmatter = {
  description?: string;
  argumentHint?: string;
  disableModelInvocation?: boolean;
};

type ParsedMarkdownCommand = {
  name: string;
  frontmatter: MarkdownFrontmatter;
};

const COMMAND_SCAN_DEPTH = 10;

// 这里只暴露 CodeM 当前已实现的内建 slash 命令。
// 其它 Claude Code 内建命令在 -p / stream-json 路径下并不会被 CLI 真正解析，
// 如果直接露给用户只会变成“未实现”提示或被当普通文本发送，所以先不展示。
export function listBuiltinSlashCommands(): SlashCommand[] {
  return [
    {
      id: 'builtin:/status',
      name: 'status',
      slash: '/status',
      title: 'Status',
      description: '显示当前项目、模型、权限模式和会话信息。',
      source: 'builtin',
      action: 'local-action',
      localActionId: 'show-status',
      sourceLabel: 'CodeM',
      category: 'system',
      agentScope: ['claude'],
    },
    {
      id: 'builtin:/compact',
      name: 'compact',
      slash: '/compact',
      title: 'Compact Context',
      description: '把当前 Claude 会话压缩成更短的上下文。',
      source: 'builtin',
      action: 'local-action',
      localActionId: 'compact-thread',
      sourceLabel: 'CodeM',
      category: 'session',
      agentScope: ['claude'],
    },
    {
      id: 'builtin:/context',
      name: 'context',
      slash: '/context',
      title: 'Context Usage',
      description: '查看当前会话的上下文使用情况。',
      source: 'builtin',
      action: 'local-action',
      localActionId: 'show-context',
      sourceLabel: 'CodeM',
      category: 'context',
      agentScope: ['claude'],
    },
    {
      id: 'builtin:/cost',
      name: 'cost',
      slash: '/cost',
      title: 'Token Cost',
      description: '查看 Token 使用统计。',
      source: 'builtin',
      action: 'local-action',
      localActionId: 'show-cost',
      sourceLabel: 'CodeM',
      category: 'context',
      agentScope: ['claude'],
    },
  ];
}

export function listAppSlashCommands(): SlashCommand[] {
  return [
    {
      id: 'app:/clear',
      name: 'clear',
      slash: '/clear',
      title: 'New Chat',
      description: '新建一个空聊天，不把当前输入发给 Claude。',
      source: 'app',
      action: 'local-action',
      localActionId: 'clear-thread',
      sourceLabel: 'CodeM',
      agentScope: ['claude'],
    },
  ];
}

export function listClaudeCustomSlashCommands(context: SlashCommandContext = {}) {
  const homeDirectory = context.homeDirectory || process.env.USERPROFILE || process.env.HOME || homedir();
  const projectDirectory = context.projectDirectory ? path.resolve(context.projectDirectory) : '';
  const pluginRoots = collectClaudePluginCommandRoots(homeDirectory);
  const sources: MarkdownCommandSource[] = [
    {
      directory: path.join(homeDirectory, '.claude', 'commands'),
      source: 'user',
      sourceLabel: 'User command',
    },
    ...(projectDirectory
      ? [{
          directory: path.join(projectDirectory, '.claude', 'commands'),
          source: 'project' as const,
          sourceLabel: 'Project command',
        }]
      : []),
    ...pluginRoots,
  ];

  return sources.flatMap((source) => scanMarkdownCommandsDirectory(source));
}

export function listSkillSlashCommands(context: SlashCommandContext = {}) {
  const skills = listSkills({
    homeDirectory: context.homeDirectory,
    projectDirectory: context.projectDirectory,
  });

  return skills.skills
    .map((skill) => buildSkillSlashCommand(skill))
    .filter((command): command is SlashCommand => Boolean(command));
}

export function listMcpSlashCommands(context: SlashCommandContext = {}) {
  const servers = listMcpServers({
    homeDirectory: context.homeDirectory,
    appDataDirectory: context.appDataDirectory,
    projectDirectory: context.projectDirectory,
  });

  return servers.servers.map<SlashCommand>((server) => {
    const segment = sanitizeMcpSegment(server.name);
    return {
      id: `mcp:${server.id}`,
      name: `mcp__${segment}__`,
      slash: `/mcp__${segment}__`,
      title: `MCP ${server.name}`,
      description: `插入 ${server.name} 的 MCP 命令前缀，后续继续补完整命令名。`,
      source: 'mcp' as const,
      action: 'passthrough' as const,
      sourceLabel: server.name,
      agentScope: ['claude'],
    };
  });
}

export function listSlashCommands(context: SlashCommandContext = {}) {
  return normalizeAndSortSlashCommands([
    ...listAppSlashCommands(),
    ...listBuiltinSlashCommands(),
    ...listClaudeCustomSlashCommands(context),
    ...listSkillSlashCommands(context),
    ...listMcpSlashCommands(context),
  ]);
}

function normalizeAndSortSlashCommands(commands: SlashCommand[]) {
  const deduped = new Map<string, SlashCommand>();

  for (const command of commands) {
    const key = command.slash.trim().toLowerCase();
    if (!key) {
      continue;
    }

    const current = deduped.get(key);
    if (!current || getSourcePriority(command.source) > getSourcePriority(current.source)) {
      deduped.set(key, command);
    }
  }

  return [...deduped.values()].sort((left, right) => {
    const sourceDelta = getSourceOrder(left.source) - getSourceOrder(right.source);
    if (sourceDelta !== 0) {
      return sourceDelta;
    }

    return left.slash.localeCompare(right.slash);
  });
}

function getSourcePriority(source: SlashCommandSource) {
  switch (source) {
    case 'app':
      return 700;
    case 'builtin':
      return 600;
    case 'project':
      return 500;
    case 'user':
      return 400;
    case 'plugin':
      return 300;
    case 'skill':
      return 200;
    case 'mcp':
    default:
      return 100;
  }
}

function getSourceOrder(source: SlashCommandSource) {
  switch (source) {
    case 'builtin':
      return 1;
    case 'project':
    case 'user':
      return 2;
    case 'plugin':
    case 'skill':
      return 3;
    case 'mcp':
      return 4;
    case 'app':
      return 5;
    default:
      return 99;
  }
}

function collectClaudePluginCommandRoots(homeDirectory: string): MarkdownCommandSource[] {
  const pluginsRoot = path.join(homeDirectory, '.claude', 'plugins');
  if (!existsSync(pluginsRoot)) {
    return [];
  }

  const seen = new Set<string>();
  const roots: MarkdownCommandSource[] = [];

  walkDirectories(pluginsRoot, 0, (directory) => {
    if (path.basename(directory).toLowerCase() !== 'commands') {
      return;
    }

    const normalized = path.resolve(directory);
    if (seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    const namespace = resolvePluginCommandNamespaceFromCommandsDirectory(normalized);
    roots.push({
      directory: normalized,
      source: 'plugin',
      sourceLabel: `${namespace} plugin`,
      namespace,
    });
  });

  return roots.sort((left, right) => left.directory.localeCompare(right.directory));
}

function walkDirectories(directory: string, depth: number, callback: (directory: string) => void) {
  if (depth > COMMAND_SCAN_DEPTH) {
    return;
  }

  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const nextDirectory = path.join(directory, entry.name);
    callback(nextDirectory);
    walkDirectories(nextDirectory, depth + 1, callback);
  }
}

function scanMarkdownCommandsDirectory(source: MarkdownCommandSource) {
  if (!existsSync(source.directory)) {
    return [];
  }

  const files = findMarkdownFiles(source.directory);
  const commands: SlashCommand[] = [];

  for (const filePath of files) {
    const parsed = parseMarkdownCommandFile(source.directory, filePath);
    if (!parsed) {
      continue;
    }

    const deprecatedAlias = buildDeprecatedSkillAliasCommand(source, parsed, filePath);
    if (deprecatedAlias) {
      commands.push(deprecatedAlias);
      continue;
    }

    if (source.source === 'plugin' && parsed.frontmatter.disableModelInvocation) {
      continue;
    }

    const resolvedName = buildSlashCommandName(source, parsed.name);

    commands.push({
      id: `${source.source}:${filePath}`,
      name: resolvedName,
      slash: `/${resolvedName}`,
      title: humanizeSlashCommandName(parsed.name),
      description: parsed.frontmatter.description,
      argumentHint: parsed.frontmatter.argumentHint,
      source: source.source,
      action: 'passthrough',
      sourceLabel: source.sourceLabel,
      agentScope: ['claude'],
    });
  }

  return commands;
}

function findMarkdownFiles(root: string) {
  const result: string[] = [];
  walkFiles(root, 0, result);
  return result;
}

function walkFiles(directory: string, depth: number, result: string[]) {
  if (depth > COMMAND_SCAN_DEPTH) {
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
    if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.md') {
      result.push(entryPath);
      continue;
    }
    if (entry.isDirectory()) {
      walkFiles(entryPath, depth + 1, result);
    }
  }
}

function parseMarkdownCommandFile(rootDirectory: string, filePath: string) {
  const relative = path.relative(rootDirectory, filePath);
  const normalizedRelative = relative.split(path.sep).join('/');
  const fileName = path.basename(filePath);
  const fileStem = path.basename(filePath, path.extname(filePath));
  const parentRelative = normalizedRelative.includes('/')
    ? normalizedRelative.slice(0, normalizedRelative.lastIndexOf('/'))
    : '';
  const parentSegments = parentRelative ? parentRelative.split('/').filter(Boolean) : [];

  let commandName = '';
  if (fileStem === 'index' || fileStem === '$ARGUMENTS') {
    if (!parentSegments.length) {
      return null;
    }
    commandName = parentSegments.join(':');
  } else if (parentSegments.length) {
    commandName = [...parentSegments, fileStem].join(':');
  } else {
    commandName = fileStem;
  }

  const normalizedName = normalizeSlashCommandName(commandName);
  if (!normalizedName) {
    return null;
  }

  const content = readFileSync(filePath, 'utf8');
  const frontmatter = parseMarkdownFrontmatter(content);
  if (!frontmatter.argumentHint && fileName === '$ARGUMENTS.md') {
    frontmatter.argumentHint = 'Arguments';
  }

  return {
    name: normalizedName,
    frontmatter,
  };
}

function buildDeprecatedSkillAliasCommand(
  source: MarkdownCommandSource,
  parsed: ParsedMarkdownCommand,
  filePath: string,
): SlashCommand | null {
  const skillName = resolveDeprecatedSuperpowersSkillName(parsed.frontmatter.description);
  if (!skillName) {
    return null;
  }

  const template = buildSkillTemplateFromName(skillName);
  if (!template) {
    return null;
  }

  const resolvedName = buildSlashCommandName(source, parsed.name);

  return {
    id: `plugin-alias:${filePath}`,
    name: resolvedName,
    slash: `/${resolvedName}`,
    title: humanizeSlashCommandName(parsed.name),
    description: parsed.frontmatter.description,
    source: 'plugin',
    action: 'insert-template',
    template,
    sourceLabel: source.sourceLabel || 'Superpowers alias',
    agentScope: ['claude'],
  };
}

function parseMarkdownFrontmatter(content: string): MarkdownFrontmatter {
  if (!content.startsWith('---')) {
    return {};
  }

  const endIndex = content.indexOf('\n---', 3);
  if (endIndex === -1) {
    return {};
  }

  const frontmatter = content.slice(3, endIndex).trim();
  const result: MarkdownFrontmatter = {};

  for (const line of frontmatter.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, '');
    if (!value) {
      continue;
    }

    if (key === 'description') {
      result.description = value;
    }
    if (key === 'argument-hint' || key === 'argument_hint') {
      result.argumentHint = value;
      continue;
    }
    if (key === 'disable-model-invocation') {
      result.disableModelInvocation = value.toLowerCase() === 'true';
    }
  }

  return result;
}

function buildSkillSlashCommand(skill: SkillSummary): SlashCommand | null {
  const normalizedName = normalizeSlashCommandName(skill.name);
  if (!normalizedName) {
    return null;
  }

  const template = buildSkillTemplate(skill);
  if (!template) {
    return null;
  }

  return {
    id: `skill:${skill.path}`,
    name: normalizedName,
    slash: `/${normalizedName}`,
    title: humanizeSlashCommandName(normalizedName),
    description: skill.description || `插入 ${normalizedName} 工作流模板。`,
    source: 'skill',
    action: 'insert-template',
    template,
    sourceLabel: `${skill.source} skill`,
    agentScope: ['claude'],
  };
}

function buildSkillTemplate(skill: SkillSummary) {
  const normalizedName = normalizeSlashCommandName(skill.name);
  return buildSkillTemplateFromName(normalizedName, skill.name, skill.description);
}

function buildSkillTemplateFromName(
  normalizedName: string,
  displayName?: string,
  description?: string,
) {
  if (!normalizedName) {
    return '';
  }

  if (normalizedName === 'brainstorming') {
    return [
      '我们先做一轮结构化 brainstorming，再进入实现。',
      '',
      '目标 / 想法：',
      '- ',
      '',
      '当前上下文：',
      '- ',
      '',
      '约束：',
      '- ',
      '',
      '我希望你先做的事：',
      '- 给出 2-3 种方案',
      '- 推荐一个方向并解释取舍',
      '- 先把设计讲清楚，不急着写代码',
    ].join('\n');
  }

  const resolvedDisplayName = displayName || normalizedName;
  return [
    `请按 “${resolvedDisplayName}” 的思路来帮我推进这件事。`,
    description ? `参考意图：${description}` : '',
    '',
    '任务：',
    '- ',
    '',
    '上下文：',
    '- ',
    '',
    '约束：',
    '- ',
    '',
    '期望输出：',
    '- ',
  ]
    .filter(Boolean)
    .join('\n');
}

function resolveDeprecatedSuperpowersSkillName(description?: string) {
  const matched = description?.match(/Deprecated\s*-\s*use the superpowers:([a-z0-9-]+) skill instead/i);
  if (!matched?.[1]) {
    return null;
  }

  return normalizeSlashCommandName(matched[1]);
}

function normalizeSlashCommandName(value: string) {
  return value
    .trim()
    .replace(/^\/+/, '')
    .replace(/[\\/]+/g, ':')
    .replace(/\s+/g, '-')
    .replace(/:+/g, ':')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function humanizeSlashCommandName(value: string) {
  return value
    .split(':')
    .map((segment) =>
      segment
        .split('-')
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' '),
    )
    .filter(Boolean)
    .join(' / ');
}

function buildSlashCommandName(source: MarkdownCommandSource, name: string) {
  const normalizedName = normalizeSlashCommandName(name);
  if (source.source !== 'plugin' || !source.namespace) {
    return normalizedName;
  }

  return `${source.namespace}:${normalizedName}`;
}

function resolvePluginCommandNamespaceFromCommandsDirectory(directory: string) {
  const normalizedSegments = path.resolve(directory).split(path.sep).filter(Boolean);
  const commandsIndex = normalizedSegments.findIndex((segment) => segment.toLowerCase() === 'commands');
  if (commandsIndex <= 0) {
    return 'plugin';
  }

  const parentSegment = normalizedSegments[commandsIndex - 1] || 'plugin';
  const maybeVersionSegment = normalizedSegments[commandsIndex - 1];
  const pluginSegment = isVersionLike(maybeVersionSegment) && commandsIndex >= 2
    ? normalizedSegments[commandsIndex - 2]
    : parentSegment;

  return normalizeSlashCommandNamespace(pluginSegment || 'plugin');
}

function normalizeSlashCommandNamespace(value: string) {
  return value
    .trim()
    .replace(/^\/+/, '')
    .replace(/[\\/]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/:+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'plugin';
}

function isVersionLike(value: string | undefined) {
  if (!value) {
    return false;
  }

  return /^\d+(\.\d+)*([.-][a-z0-9]+)?$/i.test(value);
}

function sanitizeMcpSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'server';
}
