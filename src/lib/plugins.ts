import type { InstalledPlugin, Marketplace, Skill } from '../types';

export type PluginScope = 'user' | 'project' | 'local';
export type SkillScope = 'user' | 'project';

export type PluginCommandResult = {
  stdout: string;
  stderr: string;
  exit_code: number;
  command?: string;
  args?: string[];
  cwd?: string | null;
};

export type SkillInstallEntry = {
  name: string;
  path: string;
};

export type SkillInstallResult = {
  installed: SkillInstallEntry[];
};

export const PLUGINS_CHANGED_EVENT = 'codem:plugins-changed';

export function emitPluginsChanged() {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent(PLUGINS_CHANGED_EVENT));
}

export async function fetchInstalledPlugins(): Promise<InstalledPlugin[]> {
  const response = await fetch('/api/plugins/installed');
  if (!response.ok) {
    throw new Error('读取已安装插件失败');
  }
  return (await response.json()) as InstalledPlugin[];
}

export async function fetchMarketplaces(): Promise<Marketplace[]> {
  const response = await fetch('/api/plugins/marketplaces');
  if (!response.ok) {
    throw new Error('读取插件市场失败');
  }
  return (await response.json()) as Marketplace[];
}

export async function fetchPluginSkills(projectPath?: string | null): Promise<Skill[]> {
  const query = projectPath?.trim()
    ? `?projectPath=${encodeURIComponent(projectPath.trim())}`
    : '';
  const response = await fetch(`/api/plugins/skills${query}`);
  if (!response.ok) {
    throw new Error('读取插件 Skills 失败');
  }
  return (await response.json()) as Skill[];
}

export async function installSkillFromPath(args: {
  path: string;
  scope: SkillScope;
  cwd?: string | null;
  overwrite?: boolean;
}) {
  const result = await postJson<SkillInstallResult>('/api/plugins/skills/install-from-path', args, '导入 Skill 失败');
  emitPluginsChanged();
  return result;
}

export async function installBuiltinSkill(args: { id: string; cwd?: string | null }) {
  const result = await postJson<PluginCommandResult>('/api/plugins/skills/install-builtin', args, '安装内置 Skill 失败');
  emitPluginsChanged();
  return result;
}

export async function runPluginCommand(args: {
  action: string;
  kind: 'marketplace' | 'plugin';
  target?: string | null;
  scope?: PluginScope | null;
  cwd?: string | null;
}) {
  const result = await postJson<PluginCommandResult>('/api/plugins/command', args, '执行插件命令失败');
  if (isMutatingPluginCommand(args)) {
    emitPluginsChanged();
  }
  return result;
}

export async function addMarketplace(target: string) {
  return runPluginCommand({
    kind: 'marketplace',
    action: 'add',
    target,
  });
}

export async function updateMarketplace(name: string) {
  return runPluginCommand({
    kind: 'marketplace',
    action: 'update',
    target: name,
  });
}

export async function removeMarketplace(name: string) {
  return runPluginCommand({
    kind: 'marketplace',
    action: 'remove',
    target: name,
  });
}

export async function installPlugin(
  pluginAtMarketplace: string,
  scope: PluginScope,
  cwd?: string | null,
) {
  return runPluginCommand({
    kind: 'plugin',
    action: 'install',
    target: pluginAtMarketplace,
    scope,
    cwd,
  });
}

export async function uninstallPlugin(
  pluginAtMarketplace: string,
  scope: PluginScope,
  cwd?: string | null,
) {
  return runPluginCommand({
    kind: 'plugin',
    action: 'uninstall',
    target: pluginAtMarketplace,
    scope,
    cwd,
  });
}

async function postJson<T>(url: string, payload: unknown, fallbackMessage: string) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null) as T | { error?: string } | null;
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : fallbackMessage;
    throw new Error(message);
  }

  return data as T;
}

function isMutatingPluginCommand(args: { action: string; kind: 'marketplace' | 'plugin' }) {
  if (args.kind === 'marketplace') {
    return args.action === 'add' || args.action === 'remove' || args.action === 'update';
  }

  return args.action === 'install' || args.action === 'uninstall' || args.action === 'enable' || args.action === 'disable';
}
