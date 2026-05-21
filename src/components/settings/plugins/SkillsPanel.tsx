import { useState } from 'react';
import type { Skill } from '../../../types';

type SkillsPanelProps = {
  items: Skill[];
};

export function SkillsPanel({ items }: SkillsPanelProps) {
  const [copyStateByPath, setCopyStateByPath] = useState<Record<string, 'copied' | 'failed'>>({});

  async function handleCopyPath(skill: Skill) {
    const copied = await copyTextToClipboard(skill.path);
    setCopyStateByPath((current) => ({
      ...current,
      [skill.path]: copied ? 'copied' : 'failed',
    }));
    window.setTimeout(() => {
      setCopyStateByPath((current) => {
        const { [skill.path]: _removed, ...next } = current;
        return next;
      });
    }, 1400);
  }

  return (
    <div className="settings-list settings-list-spaced plugins-skills-list">
      {items.length === 0 ? <div className="settings-list-empty">暂无 Skills</div> : null}
      {items.map((skill) => (
        <div key={skill.path} className="settings-list-row settings-list-row-tall">
          <div>
            <strong>{skill.name}</strong>
            <small>{skill.description ?? '无描述'}</small>
            <small title={skill.path}>{skill.path}</small>
          </div>
          <div className="settings-list-actions">
            <span className="settings-badge">{formatSkillSource(skill.source)}</span>
            <button
              type="button"
              className="settings-action-button"
              onClick={() => void handleCopyPath(skill)}
            >
              {copyButtonLabel(copyStateByPath[skill.path])}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

async function copyTextToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyTextWithFallback(text);
  }
}

function copyTextWithFallback(text: string) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

function copyButtonLabel(state: 'copied' | 'failed' | undefined) {
  if (state === 'copied') {
    return '已复制';
  }
  if (state === 'failed') {
    return '复制失败';
  }
  return '复制路径';
}

function formatSkillSource(source: Skill['source']) {
  if (source === 'user') {
    return '用户级';
  }
  if (source === 'project') {
    return '项目级';
  }
  if (source.startsWith('plugin:')) {
    return source.replace(/^plugin:/, '');
  }
  return source;
}
