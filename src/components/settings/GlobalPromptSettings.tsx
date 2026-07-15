import { Braces, RotateCcw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AgentProviderId, ClaudeGlobalPrompt } from '../../types';
import { AgentSettingsProviderTabs } from './AgentSettingsProviderTabs';

type SaveState = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

export function GlobalPromptSettingsSection({ defaultProviderId, projectPath }: { defaultProviderId: AgentProviderId; projectPath?: string | null }) {
  const [providerId, setProviderId] = useState<AgentProviderId>(defaultProviderId);
  const [scope, setScope] = useState<'global' | 'project'>('global');
  const [prompt, setPrompt] = useState<ClaudeGlobalPrompt | null>(null);
  const [content, setContent] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    void loadPrompt();
  }, [providerId, scope, projectPath]);

  async function loadPrompt() {
    setSaveState('loading');
    setError('');
    try {
      const response = await fetch(buildRulesUrl(providerId, scope, projectPath));
      if (!response.ok) {
        throw new Error('读取全局规则失败');
      }
      const payload = (await response.json()) as ClaudeGlobalPrompt;
      setPrompt(payload);
      setContent(typeof payload.content === 'string' ? payload.content : '');
      setSaveState('idle');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取全局规则失败');
      setSaveState('error');
    }
  }

  async function savePrompt() {
    setSaveState('saving');
    setError('');
    try {
      const response = await fetch(buildRulesUrl(providerId, scope, projectPath), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const payload = await response.json().catch(() => null) as ClaudeGlobalPrompt | { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload && 'error' in payload && payload.error ? payload.error : '保存全局规则失败');
      }
      const savedPrompt = payload as ClaudeGlobalPrompt;
      setPrompt(savedPrompt);
      setContent(savedPrompt.content);
      setSaveState('saved');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存全局规则失败');
      setSaveState('error');
    }
  }

  const path = prompt?.path ?? rulesFallbackPath(providerId, scope, projectPath);
  const status =
    saveState === 'loading'
      ? '正在读取'
      : saveState === 'saving'
        ? '正在保存'
        : saveState === 'saved'
          ? '已保存'
          : saveState === 'error'
            ? error
            : prompt?.exists
              ? '已加载'
              : '文件不存在，保存后创建';

  return (
    <section className="settings-page-section">
      <header className="settings-section-head">
        <h1>全局规则</h1>
      </header>

      <div className="agent-rules-filter-row">
        <AgentSettingsProviderTabs
          value={providerId}
          disabled={saveState === 'loading' || saveState === 'saving'}
          onChange={(nextProviderId) => {
            setProviderId(nextProviderId);
            setPrompt(null);
            setContent('');
            setError('');
          }}
        />

        <div className="settings-segmented agent-rules-scope-tabs" aria-label="规则范围">
          <button type="button" className={scope === 'global' ? 'active' : ''} onClick={() => setScope('global')}>用户级</button>
          <button type="button" className={scope === 'project' ? 'active' : ''} disabled={!projectPath} onClick={() => setScope('project')}>项目级</button>
        </div>
      </div>

      <div className="settings-panel settings-editor-panel">
        <div className="settings-editor-head">
          <div className="settings-row-label">
            <Braces size={15} />
            <span>
              <strong>{globalRulesFileName(providerId)}</strong>
              <small title={path}>{path}</small>
            </span>
          </div>
          <div className="settings-editor-actions">
            <button type="button" className="settings-action-button" onClick={() => void loadPrompt()}>
              <RotateCcw size={14} />
              <span>刷新</span>
            </button>
            <button
              type="button"
              className="settings-action-button primary"
              disabled={saveState === 'loading' || saveState === 'saving'}
              onClick={() => void savePrompt()}
            >
              <Save size={14} />
              <span>保存</span>
            </button>
          </div>
        </div>
        <textarea
          className="settings-textarea"
          value={content}
          disabled={saveState === 'loading'}
          onChange={(event) => setContent(event.target.value)}
          spellCheck={false}
        />
        <div className={`settings-editor-status${saveState === 'error' ? ' error' : ''}`}>
          <span>{status}</span>
          <span>{content.length} 字符</span>
        </div>
      </div>
    </section>
  );
}

function globalRulesFileName(providerId: AgentProviderId) {
  return providerId === 'claude-code' ? 'CLAUDE.md' : 'AGENTS.md';
}

function rulesFallbackPath(providerId: AgentProviderId, scope: 'global' | 'project', projectPath?: string | null) {
  if (scope === 'project') {
    return projectPath ? `${projectPath}/${globalRulesFileName(providerId)}` : `当前项目/${globalRulesFileName(providerId)}`;
  }
  if (providerId === 'openai-codex') return '~/.codex/AGENTS.md';
  if (providerId === 'grok-build') return '~/.grok/AGENTS.md';
  if (providerId === 'opencode') return '~/.config/opencode/AGENTS.md';
  return '~/.claude/CLAUDE.md';
}

function buildRulesUrl(providerId: AgentProviderId, scope: 'global' | 'project', projectPath?: string | null) {
  const query = new URLSearchParams({ providerId, scope });
  if (scope === 'project' && projectPath) {
    query.set('projectPath', projectPath);
  }
  return `/api/claude/system-prompt?${query.toString()}`;
}
