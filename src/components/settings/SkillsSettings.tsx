import { Copy, RotateCcw, Search, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { SkillsResponse } from '../../types';

export function SkillsSettingsSection() {
  const [payload, setPayload] = useState<SkillsResponse>({ skills: [], errors: [] });
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void loadSkills();
  }, []);

  const filteredSkills = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return payload.skills;
    }

    return payload.skills.filter((skill) =>
      [skill.name, skill.description ?? '', skill.path, skill.source]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [payload.skills, query]);

  async function loadSkills() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/skills');
      if (!response.ok) {
        throw new Error('读取 Skills 失败');
      }
      setPayload((await response.json()) as SkillsResponse);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取 Skills 失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="settings-page-section">
      <header className="settings-section-head">
        <h1>Skills</h1>
      </header>

      <div className="settings-panel settings-editor-panel">
        <div className="settings-editor-head">
          <div className="settings-row-label">
            <Sparkles size={15} />
            <span>
              <strong>只读 Skills 概览</strong>
              <small>扫描本机 Codex skills 和插件缓存</small>
            </span>
          </div>
          <button type="button" className="settings-action-button" onClick={() => void loadSkills()}>
            <RotateCcw size={14} />
            <span>刷新</span>
          </button>
        </div>

        <label className="settings-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索 name、description、path"
          />
        </label>

        <div className="settings-list settings-list-spaced">
          {loading ? <div className="settings-list-empty">正在读取 Skills</div> : null}
          {!loading && error ? <div className="settings-list-empty">{error}</div> : null}
          {!loading && !error && filteredSkills.length === 0 ? (
            <div className="settings-list-empty">没有匹配的 Skill</div>
          ) : null}
          {filteredSkills.map((skill) => (
            <div key={skill.id} className="settings-list-row settings-list-row-tall">
              <div>
                <strong>{skill.name}</strong>
                <small>{skill.description || '无描述'}</small>
                <small title={skill.path}>{skill.path}</small>
              </div>
              <div className="settings-list-actions">
                <span className="settings-badge">{skill.source}</span>
                <button
                  type="button"
                  className="settings-icon-button"
                  title="复制路径"
                  aria-label={`复制 ${skill.name} 路径`}
                  onClick={() => void navigator.clipboard?.writeText(skill.path)}
                >
                  <Copy size={14} />
                </button>
              </div>
            </div>
          ))}
          {payload.errors.map((item) => (
            <div key={item.path} className="settings-list-row settings-list-row-tall">
              <div>
                <strong>解析失败</strong>
                <small title={item.path}>{item.path}</small>
                <small>{item.message}</small>
              </div>
              <span className="settings-badge error">error</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
