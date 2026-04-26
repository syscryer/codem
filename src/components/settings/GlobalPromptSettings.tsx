import { Braces, RotateCcw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ClaudeGlobalPrompt } from '../../types';

type SaveState = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

export function GlobalPromptSettingsSection() {
  const [prompt, setPrompt] = useState<ClaudeGlobalPrompt | null>(null);
  const [content, setContent] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    void loadPrompt();
  }, []);

  async function loadPrompt() {
    setSaveState('loading');
    setError('');
    try {
      const response = await fetch('/api/claude/system-prompt');
      if (!response.ok) {
        throw new Error('读取全局提示词失败');
      }
      const payload = (await response.json()) as ClaudeGlobalPrompt;
      setPrompt(payload);
      setContent(typeof payload.content === 'string' ? payload.content : '');
      setSaveState('idle');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取全局提示词失败');
      setSaveState('error');
    }
  }

  async function savePrompt() {
    setSaveState('saving');
    setError('');
    try {
      const response = await fetch('/api/claude/system-prompt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const payload = await response.json().catch(() => null) as ClaudeGlobalPrompt | { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload && 'error' in payload && payload.error ? payload.error : '保存全局提示词失败');
      }
      const savedPrompt = payload as ClaudeGlobalPrompt;
      setPrompt(savedPrompt);
      setContent(savedPrompt.content);
      setSaveState('saved');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存全局提示词失败');
      setSaveState('error');
    }
  }

  const path = prompt?.path ?? '~/.claude/CLAUDE.md';
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
        <h1>全局提示词</h1>
      </header>

      <div className="settings-panel settings-editor-panel">
        <div className="settings-editor-head">
          <div className="settings-row-label">
            <Braces size={15} />
            <span>
              <strong>CLAUDE.md</strong>
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
