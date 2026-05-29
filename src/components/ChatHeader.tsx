import {
  Check,
  ChevronDown,
  CloudUpload,
  Download,
  GitBranchPlus,
  GitCompareArrows,
  GitCommitHorizontal,
  GitPullRequest,
  FolderOpen,
  MoreHorizontal,
  Play,
  RefreshCw,
  SquareSplitHorizontal,
  TerminalSquare,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useOutsideDismiss } from '../hooks/useOutsideDismiss';
import { PopoverPortal } from './PopoverPortal';
import { getGitDiffBadgeLabels } from '../lib/git-diff';
import { getOpenAppIcon } from '../lib/open-app-icons';
import type { OpenAppTarget, ProjectSummary, ThreadDetail } from '../types';

const LAUNCH_SCRIPTS_STORAGE_KEY = 'codem::project-launch-scripts';

type ChatHeaderProps = {
  activeProject: ProjectSummary | null;
  activeThread: ThreadDetail | null;
  isNewChatDraft: boolean;
} & ChatHeaderActionsProps;

export type ChatHeaderActionsProps = {
  activeProject: ProjectSummary | null;
  openTargets: OpenAppTarget[];
  selectedOpenTargetId: string;
  runAvailable: boolean;
  onRunLaunchScript: (command: string) => void;
  onOpenTarget: (targetId?: string) => void;
  onSelectOpenTarget: (targetId: string) => void;
  onOpenFilesWorkbench: () => void;
  onOpenGitCommit: () => void;
  onOpenGitPush: () => void;
  onOpenGitBranch: () => void;
  onOpenGitHistory: () => void;
  onGitFetch: () => void;
  onGitPull: () => void;
  terminalDockOpen: boolean;
  onToggleTerminalDock: () => void;
  terminalDockAvailable: boolean;
  rightWorkbenchOpen: boolean;
  onToggleRightWorkbench: () => void;
  onOpenReviewWorkbench: () => void;
};

export function ChatHeader({
  activeProject,
  activeThread,
  isNewChatDraft,
  openTargets,
  selectedOpenTargetId,
  runAvailable,
  onRunLaunchScript,
  onOpenTarget,
  onSelectOpenTarget,
  onOpenFilesWorkbench,
  onOpenGitCommit,
  onOpenGitPush,
  onOpenGitBranch,
  onOpenGitHistory,
  onGitFetch,
  onGitPull,
  terminalDockOpen,
  onToggleTerminalDock,
  terminalDockAvailable,
  rightWorkbenchOpen,
  onToggleRightWorkbench,
  onOpenReviewWorkbench,
}: ChatHeaderProps) {
  return (
    <header className="chat-header">
      <div className="thread-title">
        <h2>{activeThread?.title ?? (isNewChatDraft ? '新建聊天' : '选择一个聊天')}</h2>
        <span className="thread-project">{activeProject?.name ?? '未选择项目'}</span>
        <button type="button" className="more-button thread-more-button" aria-label="更多">
          <MoreHorizontal size={15} />
        </button>
      </div>
      <ChatHeaderActions
        activeProject={activeProject}
        openTargets={openTargets}
        selectedOpenTargetId={selectedOpenTargetId}
        runAvailable={runAvailable}
        onRunLaunchScript={onRunLaunchScript}
        onOpenTarget={onOpenTarget}
        onSelectOpenTarget={onSelectOpenTarget}
        onOpenFilesWorkbench={onOpenFilesWorkbench}
        onOpenGitCommit={onOpenGitCommit}
        onOpenGitPush={onOpenGitPush}
        onOpenGitBranch={onOpenGitBranch}
        onOpenGitHistory={onOpenGitHistory}
        onGitFetch={onGitFetch}
        onGitPull={onGitPull}
        terminalDockOpen={terminalDockOpen}
        onToggleTerminalDock={onToggleTerminalDock}
        terminalDockAvailable={terminalDockAvailable}
        rightWorkbenchOpen={rightWorkbenchOpen}
        onToggleRightWorkbench={onToggleRightWorkbench}
        onOpenReviewWorkbench={onOpenReviewWorkbench}
      />
    </header>
  );
}

export function ChatHeaderActions({
  activeProject,
  openTargets,
  selectedOpenTargetId,
  runAvailable,
  onRunLaunchScript,
  onOpenTarget,
  onSelectOpenTarget,
  onOpenFilesWorkbench,
  onOpenGitCommit,
  onOpenGitPush,
  onOpenGitBranch,
  onOpenGitHistory,
  onGitFetch,
  onGitPull,
  terminalDockOpen,
  onToggleTerminalDock,
  terminalDockAvailable,
  rightWorkbenchOpen,
  onToggleRightWorkbench,
  onOpenReviewWorkbench,
  compact = false,
}: ChatHeaderActionsProps & {
  compact?: boolean;
}) {
  const gitDiff = activeProject?.gitDiff ?? { additions: 0, deletions: 0, filesChanged: 0 };
  const gitDiffLabels = getGitDiffBadgeLabels(gitDiff);
  const diffTitle = !activeProject
    ? '未选择项目'
    : activeProject.isGitRepo
      ? `${gitDiff.filesChanged} 个文件变更，${gitDiffLabels.detail}（点击刷新）`
      : '当前目录不是 Git 仓库';

  return (
    <div className={`header-actions${compact ? ' compact' : ''}`}>
      <LaunchScriptButton
        activeProject={activeProject}
        disabled={!runAvailable}
        onRunLaunchScript={onRunLaunchScript}
      />
      <OpenAppMenu
        disabled={!activeProject}
        targets={openTargets}
        selectedTargetId={selectedOpenTargetId}
        onOpenTarget={onOpenTarget}
        onSelectOpenTarget={onSelectOpenTarget}
      />
      <GitActionMenu
        disabled={!activeProject?.isGitRepo}
        onOpenCommit={onOpenGitCommit}
        onOpenPush={onOpenGitPush}
        onOpenBranch={onOpenGitBranch}
        onOpenHistory={onOpenGitHistory}
        onFetch={onGitFetch}
        onPull={onGitPull}
      />
      <button
        type="button"
        className="diff-chip"
        title={diffTitle}
        aria-label={diffTitle}
        disabled={!activeProject}
        onClick={onOpenReviewWorkbench}
      >
        <GitCompareArrows size={14} aria-hidden="true" />
        <span className="diff-count">{gitDiffLabels.primary}</span>
      </button>
      {terminalDockAvailable ? (
        <button
          type="button"
          className={`icon-button${terminalDockOpen ? ' active' : ''}`}
          title={terminalDockOpen ? '隐藏终端' : '显示终端'}
          aria-pressed={terminalDockOpen}
          onClick={onToggleTerminalDock}
        >
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
      {!rightWorkbenchOpen ? (
        <button
          type="button"
          className="icon-button"
          title="展开右侧工作台"
          onClick={onToggleRightWorkbench}
        >
          <SquareSplitHorizontal size={15} />
        </button>
      ) : null}
    </div>
  );
}

function LaunchScriptButton({
  activeProject,
  disabled,
  onRunLaunchScript,
}: {
  activeProject: ProjectSummary | null;
  disabled: boolean;
  onRunLaunchScript: (command: string) => void;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [draftScript, setDraftScript] = useState('');
  const [storedScripts, setStoredScripts] = useState<Record<string, string>>(() => readLaunchScripts());
  const menuRef = useRef<HTMLDivElement | null>(null);
  const projectKey = activeProject?.path ?? null;
  const launchScript = projectKey ? storedScripts[projectKey]?.trim() ?? '' : '';
  const hasLaunchScript = Boolean(launchScript);

  useOutsideDismiss({
    selectors: [
      { selector: '.launch-script-popover', onDismiss: () => setEditorOpen(false), anchorRefs: [menuRef] },
    ],
  });

  useEffect(() => {
    setEditorOpen(false);
    setDraftScript(launchScript);
  }, [launchScript, projectKey]);

  function openEditor() {
    setDraftScript(launchScript);
    setEditorOpen(true);
  }

  function handleRun() {
    if (disabled || !activeProject) {
      return;
    }
    if (!launchScript) {
      openEditor();
      return;
    }
    onRunLaunchScript(launchScript);
  }

  function handleContextMenu(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (!disabled && activeProject) {
      openEditor();
    }
  }

  function handleSave() {
    if (!projectKey) {
      return;
    }
    const next = { ...readLaunchScripts() };
    const trimmed = draftScript.trim();
    if (trimmed) {
      next[projectKey] = draftScript;
    } else {
      delete next[projectKey];
    }
    writeLaunchScripts(next);
    setStoredScripts(next);
    setEditorOpen(false);
  }

  return (
    <div className="launch-script-menu" ref={menuRef}>
      <button
        type="button"
        className={`icon-button run-button${hasLaunchScript ? ' configured' : ''}`}
        title={hasLaunchScript ? '运行启动脚本，右键编辑' : '设置启动脚本'}
        aria-label={hasLaunchScript ? '运行启动脚本' : '设置启动脚本'}
        disabled={disabled || !activeProject}
        onClick={handleRun}
        onContextMenu={handleContextMenu}
      >
        <Play size={15} />
      </button>
      <PopoverPortal open={editorOpen} anchorRef={menuRef} placement="bottom-start" offset={8}>
        <div className="launch-script-popover" role="dialog" aria-label="启动脚本">
          <div className="launch-script-title">启动脚本</div>
          <textarea
            className="launch-script-textarea"
            placeholder="例如 npm run dev"
            value={draftScript}
            onChange={(event) => setDraftScript(event.currentTarget.value)}
            rows={6}
          />
          <div className="launch-script-actions">
            <button type="button" className="launch-script-secondary" onClick={() => setEditorOpen(false)}>
              取消
            </button>
            <button type="button" className="launch-script-primary" onClick={handleSave}>
              保存
            </button>
          </div>
        </div>
      </PopoverPortal>
    </div>
  );
}

function readLaunchScripts() {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(LAUNCH_SCRIPTS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, string>
      : {};
  } catch {
    return {};
  }
}

function writeLaunchScripts(scripts: Record<string, string>) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(LAUNCH_SCRIPTS_STORAGE_KEY, JSON.stringify(scripts));
}

function GitActionMenu({
  disabled,
  onOpenCommit,
  onOpenPush,
  onOpenBranch,
  onOpenHistory,
  onFetch,
  onPull,
}: {
  disabled: boolean;
  onOpenCommit: () => void;
  onOpenPush: () => void;
  onOpenBranch: () => void;
  onOpenHistory: () => void;
  onFetch: () => void;
  onPull: () => void;
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
        <GitCommitHorizontal size={15} />
        Git
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
          <button type="button" className="workspace-menu-item" role="menuitem" onClick={() => select(onPull)}>
            <Download size={17} />
            <span>拉取</span>
          </button>
          <button type="button" className="workspace-menu-item" role="menuitem" onClick={() => select(onFetch)}>
            <RefreshCw size={17} />
            <span>获取远端</span>
          </button>
          <button type="button" className="workspace-menu-item" role="menuitem" disabled>
            <GitPullRequest size={17} />
            <span>创建拉取请求</span>
          </button>
          <button type="button" className="workspace-menu-item" role="menuitem" onClick={() => select(onOpenBranch)}>
            <GitBranchPlus size={17} />
            <span>创建分支</span>
          </button>
          <button type="button" className="workspace-menu-item" role="menuitem" onClick={() => select(onOpenHistory)}>
            <GitPullRequest size={17} />
            <span>Git 日志</span>
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
