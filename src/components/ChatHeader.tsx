import {
  Check,
  ChevronDown,
  CloudUpload,
  GitBranchPlus,
  GitCommitHorizontal,
  GitPullRequest,
  FolderOpen,
  MoreHorizontal,
  Play,
  SquareSplitHorizontal,
  TerminalSquare,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import { PopoverPortal } from './PopoverPortal';
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
  onOpenFilesWorkbench: () => void;
  onOpenGitCommit: () => void;
  onOpenGitPush: () => void;
  rightWorkbenchOpen: boolean;
  onToggleRightWorkbench: () => void;
  onOpenReviewWorkbench: () => void;
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
  onOpenFilesWorkbench,
  onOpenGitCommit,
  onOpenGitPush,
  rightWorkbenchOpen,
  onToggleRightWorkbench,
  onOpenReviewWorkbench,
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
          <Play size={15} />
        </button>
        <OpenAppMenu
          disabled={!activeProject}
          targets={openTargets}
          selectedTargetId={selectedOpenTargetId}
          onOpenTarget={onOpenTarget}
          onSelectOpenTarget={onSelectOpenTarget}
        />
        <GitActionMenu
          disabled={!activeProject}
          onOpenCommit={onOpenGitCommit}
          onOpenPush={onOpenGitPush}
        />
        {showDebugButton ? (
          <button type="button" className="icon-button" onClick={onToggleDebug}>
            <TerminalSquare size={15} />
          </button>
        ) : null}
        <button
          type="button"
          className="icon-button"
          title="打开文件视图"
          onClick={onOpenFilesWorkbench}
          disabled={!activeProject}
        >
          <FolderOpen size={15} />
        </button>
        <button
          type="button"
          className="diff-chip"
          title={diffTitle}
          disabled={!activeProject}
          onClick={onOpenReviewWorkbench}
        >
          <span className="diff-count">{gitDiffLabels.primary}</span>
          <span className="diff-label">{gitDiffLabels.secondary}</span>
        </button>
        <button
          type="button"
          className={`icon-button${rightWorkbenchOpen ? ' active' : ''}`}
          title={rightWorkbenchOpen ? '收起右侧工作台' : '展开右侧工作台'}
          aria-pressed={rightWorkbenchOpen}
          onClick={onToggleRightWorkbench}
        >
          <SquareSplitHorizontal size={15} />
        </button>
      </div>
    </header>
  );
}

function GitActionMenu({
  disabled,
  onOpenCommit,
  onOpenPush,
}: {
  disabled: boolean;
  onOpenCommit: () => void;
  onOpenPush: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useOutsideDismiss({
    selectors: [
      { selector: '.git-action-dropdown', onDismiss: () => setOpen(false), anchorRefs: [menuRef] },
    ],
  });

  function select(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div className="git-action-menu" ref={menuRef}>
      <button
        type="button"
        className="pill-button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <CloudUpload size={15} />
        提交
        <span className="header-chevron" aria-hidden="true" />
      </button>
      <PopoverPortal open={open} anchorRef={menuRef} placement="bottom-end">
        <div className="git-action-dropdown workspace-menu" role="menu">
          <span className="workspace-menu-group-title">Git 操作</span>
          <button type="button" className="workspace-menu-item" role="menuitem" onClick={() => select(onOpenCommit)}>
            <GitCommitHorizontal size={17} />
            <span>提交</span>
          </button>
          <button type="button" className="workspace-menu-item" role="menuitem" onClick={() => select(onOpenPush)}>
            <CloudUpload size={17} />
            <span>推送</span>
          </button>
          <button type="button" className="workspace-menu-item" role="menuitem" disabled>
            <GitPullRequest size={17} />
            <span>创建拉取请求</span>
          </button>
          <button type="button" className="workspace-menu-item" role="menuitem" disabled>
            <GitBranchPlus size={17} />
            <span>创建分支</span>
          </button>
        </div>
      </PopoverPortal>
    </div>
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
    selectors: [
      { selector: '.open-app-dropdown', onDismiss: () => setOpen(false), anchorRefs: [menuRef] },
    ],
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
          <span className="open-app-icon-frame" aria-hidden="true">
            <img className="open-app-icon" data-open-app-id={selectedTarget?.id} src={selectedIcon} alt="" />
          </span>
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
          <ChevronDown size={15} />
        </button>
      </div>
      <PopoverPortal open={open} anchorRef={menuRef} placement="bottom-end">
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
              <span className="open-app-option-icon-frame" aria-hidden="true">
                <img className="open-app-option-icon" data-open-app-id={target.id} src={getOpenAppIcon(target.id)} alt="" />
              </span>
              <span>{target.label}</span>
              {target.id === selectedTarget?.id ? <Check className="open-app-check" size={15} /> : null}
            </button>
          ))}
        </div>
      </PopoverPortal>
    </div>
  );
}
