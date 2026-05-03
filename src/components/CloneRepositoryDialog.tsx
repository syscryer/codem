import { FolderOpen, GitBranchPlus, LoaderCircle, X } from 'lucide-react';
import { useEffect, useState } from 'react';

type CloneRepositoryDialogProps = {
  open: boolean;
  initialBaseDirectory?: string;
  onClose: () => void;
  onPickBaseDirectory: (currentBaseDirectory?: string) => Promise<string | null>;
  onSubmit: (payload: {
    repoUrl: string;
    baseDirectory: string;
    folderName: string;
  }) => Promise<void>;
};

export function CloneRepositoryDialog({
  open,
  initialBaseDirectory,
  onClose,
  onPickBaseDirectory,
  onSubmit,
}: CloneRepositoryDialogProps) {
  const [repoUrl, setRepoUrl] = useState('');
  const [baseDirectory, setBaseDirectory] = useState('');
  const [folderName, setFolderName] = useState('');
  const [folderNameTouched, setFolderNameTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pickingDirectory, setPickingDirectory] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      return;
    }

    setRepoUrl('');
    setBaseDirectory(initialBaseDirectory ?? '');
    setFolderName('');
    setFolderNameTouched(false);
    setSubmitting(false);
    setPickingDirectory(false);
    setError('');
  }, [initialBaseDirectory, open]);

  if (!open) {
    return null;
  }

  const trimmedRepoUrl = repoUrl.trim();
  const trimmedBaseDirectory = baseDirectory.trim();
  const trimmedFolderName = folderName.trim();
  const submitDisabled = submitting || !trimmedRepoUrl || !trimmedBaseDirectory || !trimmedFolderName;

  function handleRepoUrlChange(value: string) {
    setRepoUrl(value);
    setError('');

    if (!folderNameTouched) {
      setFolderName(guessFolderNameFromRepoUrl(value));
    }
  }

  async function handlePickBaseDirectory() {
    setPickingDirectory(true);
    setError('');
    try {
      const selectedPath = await onPickBaseDirectory(baseDirectory.trim() || undefined);
      if (selectedPath) {
        setBaseDirectory(selectedPath);
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '选择保存位置失败');
    } finally {
      setPickingDirectory(false);
    }
  }

  async function handleSubmit() {
    if (submitDisabled) {
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await onSubmit({
        repoUrl: trimmedRepoUrl,
        baseDirectory: trimmedBaseDirectory,
        folderName: trimmedFolderName,
      });
      onClose();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '克隆仓库失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dialog-backdrop git-dialog-backdrop" role="presentation" onClick={() => !submitting && onClose()}>
      <section
        className="dialog-card clone-dialog-card"
        role="dialog"
        aria-modal="true"
        aria-label="克隆 Git 仓库"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="git-dialog-head clone-dialog-head">
          <div>
            <span className="git-dialog-kicker">新增项目</span>
            <h3>克隆 Git 仓库</h3>
            <p>克隆完成后会按普通项目目录接入当前工作区。</p>
          </div>
          <button type="button" className="icon-button" aria-label="关闭" disabled={submitting} onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        <div className="clone-dialog-form">
          <label className="clone-dialog-field">
            <span>仓库地址</span>
            <input
              autoFocus
              className="dialog-input"
              value={repoUrl}
              placeholder="https://github.com/user/repo.git"
              onChange={(event) => handleRepoUrlChange(event.target.value)}
            />
            <small>支持 HTTPS 和 SSH，例如 `git@gitee.com:org/repo.git`。</small>
          </label>

          <label className="clone-dialog-field">
            <span>保存位置</span>
            <div className="clone-dialog-path-row">
              <input
                className="dialog-input"
                value={baseDirectory}
                placeholder="选择克隆到哪个目录"
                onChange={(event) => {
                  setBaseDirectory(event.target.value);
                  setError('');
                }}
              />
              <button
                type="button"
                className="dialog-button secondary clone-dialog-pick-button"
                disabled={submitting || pickingDirectory}
                onClick={() => void handlePickBaseDirectory()}
              >
                {pickingDirectory ? <LoaderCircle className="spin" size={15} /> : <FolderOpen size={15} />}
                选择
              </button>
            </div>
          </label>

          <label className="clone-dialog-field">
            <span>项目目录名</span>
            <input
              className="dialog-input"
              value={folderName}
              placeholder="repo"
              onChange={(event) => {
                setFolderNameTouched(true);
                setFolderName(event.target.value);
                setError('');
              }}
            />
          </label>

          <div className="clone-dialog-target">
            <GitBranchPlus size={16} />
            <span>{trimmedBaseDirectory && trimmedFolderName ? `${trimmedBaseDirectory}\\${trimmedFolderName}` : '克隆后的项目目录会显示在这里'}</span>
          </div>
        </div>

        {error ? <div className="dialog-error git-dialog-error">{error}</div> : null}

        <div className="dialog-actions clone-dialog-actions">
          <button type="button" className="dialog-button secondary" disabled={submitting} onClick={onClose}>
            取消
          </button>
          <button type="button" className="dialog-button primary" disabled={submitDisabled} onClick={() => void handleSubmit()}>
            {submitting ? <LoaderCircle className="spin" size={15} /> : null}
            {submitting ? '正在克隆...' : '开始克隆'}
          </button>
        </div>
      </section>
    </div>
  );
}

function guessFolderNameFromRepoUrl(repoUrl: string) {
  const trimmed = repoUrl.trim();
  if (!trimmed) {
    return '';
  }

  const normalized = trimmed.replace(/[\\/]+$/, '');
  const lastSegment = normalized.split('/').at(-1)?.split(':').at(-1) ?? '';
  return lastSegment.replace(/\.git$/i, '').trim();
}
