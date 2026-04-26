import { Check, ChevronDown, Home, MoreHorizontal, Play, SquareSplitHorizontal, TerminalSquare } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import { getGitDiffBadgeLabels } from '../lib/git-diff';
import { getOpenAppIcon } from '../lib/open-app-icons';
import type { OpenAppTarget, ProjectSummary, ThreadDetail } from '../types';

type ChatHeaderProps = {
  activeProject: ProjectSummary | null;
  activeThread: ThreadDetail | null;
  openTargets: OpenAppTarget[];
  selectedOpenTargetId: string;
  showDebugButton: boolean;
  onToggleDebug: () => void;
  onOpenTarget: (targetId?: string) => void;
  onSelectOpenTarget: (targetId: string) => void;
  onRefreshGitDiff: () => void;
  onUseProjectWorkspace: () => void;
};

export function ChatHeader({
  activeProject,
  activeThread,
  openTargets,
  selectedOpenTargetId,
  showDebugButton,
  onToggleDebug,
  onOpenTarget,
  onSelectOpenTarget,
  onRefreshGitDiff,
  onUseProjectWorkspace,
}: ChatHeaderProps) {
  const gitDiff = activeProject?.gitDiff ?? { additions: 0, deletions: 0, filesChanged: 0 };
  const gitDiffLabels = getGitDiffBadgeLabels(gitDiff);
  const diffTitle = !activeProject
    ? '未选择项目'
    : activeProject.isGitRepo
      ? `${gitDiff.filesChanged} 个文件变更，${gitDiffLabels.detail}（点击刷新）`
      : '当前目录不是 Git 仓库';

  return (
    <header className="chat-header">
      <div className="thread-title">
        <h2>{activeThread?.title ?? '选择一个聊天'}</h2>
        <span className="thread-project">{activeProject?.name ?? '未选择项目'}</span>
        <button type="button" className="more-button thread-more-button" aria-label="更多">
          <MoreHorizontal size={15} />
        </button>
      </div>
      <div className="header-actions">
        <button type="button" className="icon-button" title="运行">
          <Play size={14} />
        </button>
        <OpenAppMenu
          disabled={!activeProject}
          targets={openTargets}
          selectedTargetId={selectedOpenTargetId}
          onOpenTarget={onOpenTarget}
          onSelectOpenTarget={onSelectOpenTarget}
        />
        <button type="button" className="pill-button">
          提交
          <span className="header-chevron" aria-hidden="true" />
        </button>
        {showDebugButton ? (
          <button type="button" className="icon-button" onClick={onToggleDebug}>
            <TerminalSquare size={14} />
          </button>
        ) : null}
        <button
          type="button"
          className="icon-button"
          title="使用当前项目目录"
          onClick={onUseProjectWorkspace}
        >
          <Home size={14} />
        </button>
        <button
          type="button"
          className="diff-chip"
          title={diffTitle}
          disabled={!activeProject?.isGitRepo}
          onClick={onRefreshGitDiff}
        >
          <span className="diff-count">{gitDiffLabels.primary}</span>
          <span className="diff-label">{gitDiffLabels.secondary}</span>
        </button>
        <button type="button" className="icon-button" title="布局">
          <SquareSplitHorizontal size={14} />
        </button>
      </div>
    </header>
  );
}

function OpenAppMenu({
  disabled,
  targets,
  selectedTargetId,
  onOpenTarget,
  onSelectOpenTarget,
}: {
  disabled: boolean;
  targets: OpenAppTarget[];
  selectedTargetId: string;
  onOpenTarget: (targetId?: string) => void;
  onSelectOpenTarget: (targetId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selectedTarget = useMemo(
    () => targets.find((target) => target.id === selectedTargetId) ?? targets[0],
    [selectedTargetId, targets],
  );

  useOutsideDismiss({
    refs: [{ ref: menuRef, onDismiss: () => setOpen(false) }],
  });

  const selectedIcon = getOpenAppIcon(selectedTarget?.id ?? 'vscode');
  const selectedLabel = selectedTarget?.label ?? 'Open';

  return (
    <div className="open-app-menu" ref={menuRef}>
      <div className="open-app-trigger">
        <button
          type="button"
          className="open-app-main"
          title={`在 ${selectedLabel} 中打开`}
          aria-label={`在 ${selectedLabel} 中打开`}
          disabled={disabled || !selectedTarget}
          onClick={() => onOpenTarget(selectedTarget?.id)}
        >
          <img className="open-app-icon" src={selectedIcon} alt="" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="open-app-toggle"
          title="选择打开工具"
          aria-label="选择打开工具"
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled || targets.length === 0}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDown size={14} />
        </button>
      </div>
      {open ? (
        <div className="open-app-dropdown" role="menu">
          {targets.map((target) => (
            <button
              key={target.id}
              type="button"
              className={`open-app-option${target.id === selectedTarget?.id ? ' active' : ''}`}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSelectOpenTarget(target.id);
                onOpenTarget(target.id);
              }}
            >
              <img className="open-app-option-icon" src={getOpenAppIcon(target.id)} alt="" aria-hidden="true" />
              <span>{target.label}</span>
              {target.id === selectedTarget?.id ? <Check className="open-app-check" size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
