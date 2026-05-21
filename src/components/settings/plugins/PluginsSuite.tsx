import { Blocks, Download, FolderOpen, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { InstalledPlugin, Marketplace, PluginSubTab, PluginTab, Skill } from '../../../types';
import {
  addMarketplace,
  fetchInstalledPlugins,
  fetchMarketplaces,
  fetchPluginSkills,
  installBuiltinSkill,
  installPlugin,
  installSkillFromPath,
  PLUGINS_CHANGED_EVENT,
  removeMarketplace,
  uninstallPlugin,
  updateMarketplace,
  type PluginScope,
  type SkillScope,
} from '../../../lib/plugins';
import { analyzePluginError } from '../../../lib/plugin-error-hints';
import { DiscoverPluginsPanel } from './DiscoverPluginsPanel';
import { InstalledPluginsPanel } from './InstalledPluginsPanel';
import { MarketplacesPanel } from './MarketplacesPanel';
import { SkillsPanel } from './SkillsPanel';

const builtinSkillInstallers = [
  {
    id: 'playwright-cli',
    label: 'playwright-cli',
    description: '安装浏览器自动化内置技能。',
  },
];

const marketplacePresets = [
  'anthropics/claude-code',
  'anthropics/claude-plugins-official',
  'obra/superpowers-marketplace',
];

export function PluginsSuite() {
  const [tab, setTab] = useState<PluginTab>('plugins');
  const [subTab, setSubTab] = useState<PluginSubTab>('installed');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorDetail, setErrorDetail] = useState('');
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [marketplaceInput, setMarketplaceInput] = useState('');
  const [skillImportPath, setSkillImportPath] = useState('');
  const [skillImportScope, setSkillImportScope] = useState<SkillScope>('user');
  const [skillImportOverwrite, setSkillImportOverwrite] = useState(false);
  const [pluginInstallScope, setPluginInstallScope] = useState<PluginScope>('user');
  const [pickingSkillDirectory, setPickingSkillDirectory] = useState(false);
  const [skillImportDialogOpen, setSkillImportDialogOpen] = useState(false);

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    function handlePluginsChanged() {
      void refreshAll();
    }

    window.addEventListener(PLUGINS_CHANGED_EVENT, handlePluginsChanged);
    return () => window.removeEventListener(PLUGINS_CHANGED_EVENT, handlePluginsChanged);
  }, []);

  const filteredInstalled = useMemo(() => filterInstalledPlugins(installed, query), [installed, query]);
  const filteredMarketplaces = useMemo(() => filterMarketplaces(marketplaces, query), [marketplaces, query]);
  const filteredSkills = useMemo(() => filterSkills(skills, query), [skills, query]);
  const discoverItems = useMemo(() => buildDiscoverItems(marketplaces, installed, query), [installed, marketplaces, query]);

  async function refreshAll() {
    setLoading(true);
    setError('');
    setErrorDetail('');
    try {
      const [nextInstalled, nextMarketplaces, nextSkills] = await Promise.all([
        fetchInstalledPlugins(),
        fetchMarketplaces(),
        fetchPluginSkills(null),
      ]);
      setInstalled(nextInstalled);
      setMarketplaces(nextMarketplaces);
      setSkills(nextSkills);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取插件数据失败');
      setErrorDetail(loadError instanceof Error ? loadError.message : '');
    } finally {
      setLoading(false);
    }
  }

  async function performMutation(action: string, task: () => Promise<void>) {
    setBusy(true);
    setError('');
    setErrorDetail('');
    try {
      await task();
      await refreshAll();
      return true;
    } catch (mutationError) {
      const analysis = analyzePluginError(action, mutationError);
      setError(`${analysis.summary}。${analysis.hints[0]?.message ?? analysis.raw}`);
      setErrorDetail(analysis.raw);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleAddMarketplace() {
    const target = marketplaceInput.trim();
    if (!target) {
      return;
    }

    await performMutation('添加 Marketplace', async () => {
      await addMarketplace(target);
      setMarketplaceInput('');
    });
  }

  async function handleInstallSkillFromPath() {
    const targetPath = skillImportPath.trim();
    if (!targetPath) {
      return;
    }

    const imported = await performMutation('导入 Skill', async () => {
      await installSkillFromPath({
        path: targetPath,
        scope: skillImportScope,
        overwrite: skillImportOverwrite,
      });
      setSkillImportPath('');
      setSkillImportOverwrite(false);
      setSkillImportScope('user');
    });
    if (imported) {
      setSkillImportDialogOpen(false);
    }
  }

  async function handlePickSkillDirectory() {
    setPickingSkillDirectory(true);
    setError('');
    setErrorDetail('');
    try {
      const selectedPath = await selectDirectoryPath(skillImportPath || undefined);
      if (selectedPath) {
        setSkillImportPath(selectedPath);
      }
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : '选择目录失败');
      setErrorDetail(pickError instanceof Error ? pickError.message : '');
    } finally {
      setPickingSkillDirectory(false);
    }
  }

  return (
    <section className="settings-page-section">
      <header className="settings-section-head">
        <h1>插件 & 技能</h1>
        <p>管理 Claude Code 原生插件与技能；与 CLI 共用同一份配置。</p>
      </header>

      <div className="settings-panel settings-editor-panel plugins-suite-panel">
        <div className="plugins-panel-topbar">
          <div className="plugins-nav-stack">
            <div className="plugins-primary-tabs" aria-label="插件与技能">
              <button type="button" className={tab === 'plugins' ? 'active' : ''} onClick={() => setTab('plugins')}>
                <Blocks size={15} />
                <span>插件</span>
                <TabCount value={installed.length} />
              </button>
              <button type="button" className={tab === 'skills' ? 'active' : ''} onClick={() => setTab('skills')}>
                <Sparkles size={15} />
                <span>技能</span>
                <TabCount value={skills.length} />
              </button>
            </div>

            {tab === 'plugins' ? (
              <div className="plugins-secondary-tabs" aria-label="插件分类">
                <button type="button" className={subTab === 'installed' ? 'active' : ''} onClick={() => setSubTab('installed')}>
                  <span>已安装</span>
                  <TabCount value={installed.length} />
                </button>
                <button type="button" className={subTab === 'discover' ? 'active' : ''} onClick={() => setSubTab('discover')}>
                  <span>发现</span>
                  <TabCount value={discoverItems.length} />
                </button>
                <button type="button" className={subTab === 'marketplaces' ? 'active' : ''} onClick={() => setSubTab('marketplaces')}>
                  <span>Marketplace</span>
                  <TabCount value={marketplaces.length} />
                </button>
              </div>
            ) : null}
          </div>
          <div className="settings-editor-actions">
            <button type="button" className="settings-action-button" disabled={loading || busy} onClick={() => void refreshAll()}>
              刷新
            </button>
          </div>
        </div>

        {tab === 'plugins' ? (
          <>
            <div className="plugins-toolbar">
              <label className="settings-search">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索插件、marketplace、描述"
                />
              </label>
              {subTab === 'discover' ? (
                <label className="settings-inline-form plugins-inline-select">
                  <span>安装范围</span>
                  <select value={pluginInstallScope} onChange={(event) => setPluginInstallScope(event.target.value as PluginScope)}>
                    <option value="user">用户级</option>
                    <option value="project">项目级</option>
                    <option value="local">本地</option>
                  </select>
                </label>
              ) : null}
            </div>

            {subTab === 'marketplaces' ? (
              <div className="plugins-marketplace-actions">
                <div className="plugins-input-grid">
                  <input
                    className="settings-text-input"
                    value={marketplaceInput}
                    onChange={(event) => setMarketplaceInput(event.target.value)}
                    placeholder="owner/repo 或 marketplace URL"
                  />
                  <button type="button" className="settings-action-button primary" disabled={busy || !marketplaceInput.trim()} onClick={() => void handleAddMarketplace()}>
                    添加 Marketplace
                  </button>
                </div>
                <div className="plugins-preset-row" aria-label="常用 Marketplace">
                  {marketplacePresets.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className="plugins-preset-button"
                      disabled={busy}
                      onClick={() => setMarketplaceInput(preset)}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="plugins-toolbar">
              <label className="settings-search">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索 skill 名称、来源、路径"
                />
              </label>
              <button
                type="button"
                className="settings-action-button primary plugins-import-trigger"
                disabled={busy}
                onClick={() => setSkillImportDialogOpen(true)}
              >
                <Download size={14} />
                导入技能
              </button>
            </div>

            <div className="plugins-skill-actions">
              <div className="plugins-builtin-grid">
                {builtinSkillInstallers.map((item) => (
                  <div key={item.id} className="plugins-builtin-card">
                    <div>
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </div>
                    <button
                      type="button"
                      className="settings-action-button"
                      disabled={busy}
                      onClick={() => void performMutation('安装内置 Skill', async () => {
                        await installBuiltinSkill({ id: item.id });
                      })}
                    >
                      安装
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {loading ? <div className="settings-list-empty">正在读取插件数据</div> : null}
        {!loading && error ? (
          <div className="plugins-error-panel">
            <strong>{error}</strong>
            {errorDetail && errorDetail !== error ? <small>{errorDetail}</small> : null}
          </div>
        ) : null}
        {!loading && !error && tab === 'plugins' && subTab === 'installed' ? (
          <InstalledPluginsPanel
            items={filteredInstalled}
            busy={busy}
            onUninstall={(item) => {
              void performMutation('卸载插件', async () => {
                await uninstallPlugin(item.id, normalizePluginScope(item.scope));
              });
            }}
          />
        ) : null}
        {!loading && !error && tab === 'plugins' && subTab === 'discover' ? (
          <DiscoverPluginsPanel
            items={discoverItems}
            busy={busy}
            onInstall={(item) => {
              void performMutation('安装插件', async () => {
                await installPlugin(`${item.plugin.name}@${item.marketplace}`, pluginInstallScope);
              });
            }}
          />
        ) : null}
        {!loading && !error && tab === 'plugins' && subTab === 'marketplaces' ? (
          <MarketplacesPanel
            items={filteredMarketplaces}
            busy={busy}
            onRefresh={(marketplace) => {
              void performMutation('刷新 Marketplace', async () => {
                await updateMarketplace(marketplace.name);
              });
            }}
            onRemove={(marketplace) => {
              void performMutation('移除 Marketplace', async () => {
                await removeMarketplace(marketplace.name);
              });
            }}
          />
        ) : null}
        {!loading && !error && tab === 'skills' ? (
          <SkillsPanel items={filteredSkills} />
        ) : null}
      </div>

      {skillImportDialogOpen ? (
        <div
          className="dialog-backdrop plugins-import-backdrop"
          role="presentation"
          onClick={() => {
            if (!busy && !pickingSkillDirectory) {
              setSkillImportDialogOpen(false);
            }
          }}
        >
          <section
            className="dialog-card plugins-import-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="plugins-import-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="plugins-import-head">
              <div>
                <h2 id="plugins-import-title">
                  <FolderOpen size={20} />
                  导入技能
                </h2>
                <p>选择包含 SKILL.md 的技能目录，或包含多个技能子目录的父目录。</p>
              </div>
              <button
                type="button"
                className="settings-icon-button plugins-import-close"
                aria-label="关闭导入技能"
                disabled={busy || pickingSkillDirectory}
                onClick={() => setSkillImportDialogOpen(false)}
              >
                <X size={18} />
              </button>
            </header>

            <div className="plugins-import-body">
              <label className="plugins-import-field">
                <span>技能目录</span>
                <div className="plugins-import-path-row">
                  <input
                    className="settings-text-input"
                    value={skillImportPath}
                    onChange={(event) => setSkillImportPath(event.target.value)}
                    placeholder="C:/Users/you/Downloads/my-skill"
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className="settings-action-button"
                    disabled={busy || pickingSkillDirectory}
                    onClick={() => void handlePickSkillDirectory()}
                  >
                    <FolderOpen size={15} />
                    {pickingSkillDirectory ? '选择中' : '浏览'}
                  </button>
                </div>
              </label>

              <label className="plugins-import-field">
                <span>安装范围</span>
                <select
                  className="plugins-import-select"
                  value={skillImportScope}
                  disabled={busy}
                  onChange={(event) => setSkillImportScope(event.target.value as SkillScope)}
                >
                  <option value="user">用户级（所有项目）</option>
                  <option value="project">项目级（当前项目）</option>
                </select>
              </label>

              <label className="plugins-import-option">
                <span>
                  <strong>覆盖同名技能</strong>
                  <small>关闭时遇到同名技能会直接报错，不会替换现有目录。</small>
                </span>
                <span className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={skillImportOverwrite}
                    disabled={busy}
                    onChange={(event) => setSkillImportOverwrite(event.target.checked)}
                  />
                  <span aria-hidden="true" />
                </span>
              </label>

              <div className="plugins-import-location">
                <strong>安装位置</strong>
                <small>
                  用户级写入 <code>~/.claude/skills</code>；项目级写入当前项目的 <code>.claude/skills</code>。
                </small>
              </div>
            </div>

            <footer className="plugins-import-actions">
              <button
                type="button"
                className="settings-action-button"
                disabled={busy || pickingSkillDirectory}
                onClick={() => setSkillImportDialogOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="settings-action-button primary"
                disabled={busy || pickingSkillDirectory || !skillImportPath.trim()}
                onClick={() => void handleInstallSkillFromPath()}
              >
                <Download size={14} />
                导入
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function TabCount({ value }: { value: number }) {
  return <span className="plugins-tab-count">{value}</span>;
}

function filterInstalledPlugins(items: InstalledPlugin[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return items;
  }

  return items.filter((item) =>
    [
      item.name,
      item.marketplace,
      item.description ?? '',
      item.scope,
      item.version ?? '',
    ]
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery),
  );
}

function filterMarketplaces(items: Marketplace[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return items;
  }

  return items.filter((item) =>
    [item.name, item.source ?? '', item.plugins.map((plugin) => plugin.name).join(' ')]
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery),
  );
}

function filterSkills(items: Skill[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return items;
  }

  return items.filter((item) =>
    [item.name, item.description ?? '', item.source, item.path]
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery),
  );
}

function buildDiscoverItems(marketplaces: Marketplace[], installed: InstalledPlugin[], query: string) {
  const installedIds = new Set(installed.map((item) => item.id));
  const normalizedQuery = query.trim().toLowerCase();
  const items = marketplaces.flatMap((marketplace) =>
    marketplace.plugins.map((plugin) => ({
      plugin,
      marketplace: marketplace.name,
      installed: installedIds.has(`${plugin.name}@${marketplace.name}`),
    })),
  );

  if (!normalizedQuery) {
    return items;
  }

  return items.filter((item) =>
    [
      item.plugin.name,
      item.marketplace,
      item.plugin.description ?? '',
      item.plugin.author ?? '',
      item.plugin.category ?? '',
    ]
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery),
  );
}

function normalizePluginScope(scope: string): PluginScope {
  if (scope === 'project' || scope === 'local') {
    return scope;
  }
  return 'user';
}

async function selectDirectoryPath(initialPath?: string) {
  const response = await fetch('/api/system/select-directory', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      initialPath: initialPath || undefined,
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const payload = (await response.json()) as { ok: true; path: string | null };
  return payload.path;
}
