import { Clipboard, FolderOpen, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { AgentProviderId, Skill } from '../../../types';
import { AgentProviderIcon } from '../../AgentProviderIcon';

type SkillsPanelProps = {
  items: Skill[];
  providerId: AgentProviderId;
  busy: boolean;
  onOpen: (skill: Skill) => void;
  onDelete: (skill: Skill) => void;
  onCopy: (skill: Skill, targetProviderId: AgentProviderId) => void;
};

const providerLabels: Record<AgentProviderId, string> = {
  'claude-code': 'Claude',
  'openai-codex': 'Codex',
  'grok-build': 'Grok',
};

export function SkillsPanel({ items, providerId, busy, onOpen, onDelete, onCopy }: SkillsPanelProps) {
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
            <span className="settings-badge" title={skill.source}>{formatSkillSource(skill.source)}</span>
            <button
              type="button"
              className="settings-icon-button"
              aria-label={copyButtonLabel(copyStateByPath[skill.path])}
              title={copyButtonLabel(copyStateByPath[skill.path])}
              onClick={() => void handleCopyPath(skill)}
            >
              <Clipboard size={15} />
            </button>
            <button type="button" className="settings-icon-button" aria-label="打开 Skill 目录" disabled={busy} onClick={() => onOpen(skill)}>
              <FolderOpen size={15} />
            </button>
            {(['claude-code', 'openai-codex', 'grok-build'] as AgentProviderId[])
              .filter((targetProviderId) => targetProviderId !== providerId)
              .map((targetProviderId) => (
                <button
                  key={targetProviderId}
                  type="button"
                  className="settings-icon-button"
                  aria-label={`复制到 ${providerLabels[targetProviderId]}`}
                  title={`复制到 ${providerLabels[targetProviderId]}`}
                  disabled={busy}
                  onClick={() => onCopy(skill, targetProviderId)}
                >
                  <AgentProviderIcon providerId={targetProviderId} size={15} />
                </button>
              ))}
            {skill.source === 'user' || skill.source === 'project' ? (
              <button type="button" className="settings-icon-button danger" aria-label="删除 Skill" disabled={busy} onClick={() => onDelete(skill)}>
                <Trash2 size={15} />
              </button>
            ) : null}
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
    return '插件';
  }
  return source;
}
