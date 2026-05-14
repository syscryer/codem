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

export function PluginsSuite() {
  const [tab, setTab] = useState<PluginTab>('plugins');
  const [subTab, setSubTab] = useState<PluginSubTab>('installed');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [marketplaceInput, setMarketplaceInput] = useState('');
  const [skillImportPath, setSkillImportPath] = useState('');
  const [skillImportScope, setSkillImportScope] = useState<SkillScope>('user');
  const [skillImportOverwrite, setSkillImportOverwrite] = useState(false);
  const [pluginInstallScope, setPluginInstallScope] = useState<PluginScope>('user');

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
    } finally {
      setLoading(false);
    }
  }

  async function performMutation(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await task();
      await refreshAll();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : '插件操作失败');
    } finally {
      setBusy(false);
    }
  }

  async function handleAddMarketplace() {
    const target = marketplaceInput.trim();
    if (!target) {
      return;
    }

    await performMutation(async () => {
      await addMarketplace(target);
      setMarketplaceInput('');
    });
  }

  async function handleInstallSkillFromPath() {
    const targetPath = skillImportPath.trim();
    if (!targetPath) {
      return;
    }

    await performMutation(async () => {
      await installSkillFromPath({
        path: targetPath,
        scope: skillImportScope,
        overwrite: skillImportOverwrite,
      });
      setSkillImportPath('');
      setSkillImportOverwrite(false);
      setSkillImportScope('user');
    });
  }

  return (
    <section className="settings-page-section">
      <header className="settings-section-head">
        <h1>Plugins</h1>
      </header>

      <div className="settings-panel settings-editor-panel plugins-suite-panel">
        <div className="settings-editor-head">
          <div className="settings-row-label">
            <span>
              <strong>Claude 插件与 Skills</strong>
              <small>沿用 Claudinal 的信息结构，但保持 CodeM 设置页风格。</small>
            </span>
          </div>
          <div className="settings-editor-actions">
            <button type="button" className="settings-action-button" disabled={loading || busy} onClick={() => void refreshAll()}>
              刷新
            </button>
          </div>
        </div>

        <div className="settings-segmented">
          <button type="button" className={tab === 'plugins' ? 'active' : ''} onClick={() => setTab('plugins')}>
            Plugins
          </button>
          <button type="button" className={tab === 'skills' ? 'active' : ''} onClick={() => setTab('skills')}>
            Skills
          </button>
        </div>

        {tab === 'plugins' ? (
          <>
            <div className="settings-segmented">
              <button type="button" className={subTab === 'installed' ? 'active' : ''} onClick={() => setSubTab('installed')}>
                Installed
              </button>
              <button type="button" className={subTab === 'discover' ? 'active' : ''} onClick={() => setSubTab('discover')}>
                Discover
              </button>
              <button type="button" className={subTab === 'marketplaces' ? 'active' : ''} onClick={() => setSubTab('marketplaces')}>
                Marketplaces
              </button>
            </div>

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
            </div>

            <div className="plugins-skill-actions">
              <div className="plugins-input-grid">
                <input
                  className="settings-text-input"
                  value={skillImportPath}
                  onChange={(event) => setSkillImportPath(event.target.value)}
                  placeholder="本地技能目录路径"
                />
                <select value={skillImportScope} onChange={(event) => setSkillImportScope(event.target.value as SkillScope)}>
                  <option value="user">用户级</option>
                  <option value="project">项目级</option>
                </select>
                <label className="plugins-inline-check">
                  <input
                    type="checkbox"
                    checked={skillImportOverwrite}
                    onChange={(event) => setSkillImportOverwrite(event.target.checked)}
                  />
                  <span>覆盖同名</span>
                </label>
                <button
                  type="button"
                  className="settings-action-button primary"
                  disabled={busy || !skillImportPath.trim()}
                  onClick={() => void handleInstallSkillFromPath()}
                >
                  导入 Skill
                </button>
              </div>

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
                      onClick={() => void performMutation(async () => {
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
        {!loading && error ? <div className="settings-list-empty">{error}</div> : null}
        {!loading && !error && tab === 'plugins' && subTab === 'installed' ? (
          <InstalledPluginsPanel
            items={filteredInstalled}
            busy={busy}
            onUninstall={(item) => {
              void performMutation(async () => {
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
              void performMutation(async () => {
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
              void performMutation(async () => {
                await updateMarketplace(marketplace.name);
              });
            }}
            onRemove={(marketplace) => {
              void performMutation(async () => {
                await removeMarketplace(marketplace.name);
              });
            }}
          />
        ) : null}
        {!loading && !error && tab === 'skills' ? (
          <SkillsPanel
            items={filteredSkills}
            onCopyPath={(skill) => {
              void navigator.clipboard?.writeText(skill.path);
            }}
          />
        ) : null}
      </div>
    </section>
  );
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
