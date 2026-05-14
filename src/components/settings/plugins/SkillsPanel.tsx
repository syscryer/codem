import type { Skill } from '../../../types';

type SkillsPanelProps = {
  items: Skill[];
  onCopyPath?: (skill: Skill) => void;
};

export function SkillsPanel({ items, onCopyPath }: SkillsPanelProps) {
  return (
    <div className="settings-list settings-list-spaced">
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
              onClick={() => onCopyPath?.(skill)}
            >
              复制路径
            </button>
          </div>
        </div>
      ))}
    </div>
  );
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
