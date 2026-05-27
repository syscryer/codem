import { Search } from 'lucide-react';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import type { ProjectSummary } from '../types';

type SessionSearchDialogProps = {
  open: boolean;
  query: string;
  projects: ProjectSummary[];
  activeThreadId: string | null;
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onSelectThread: (projectId: string, threadId: string) => void | Promise<void>;
};

type SessionSearchEntry = {
  threadId: string;
  projectId: string;
  title: string;
  projectName: string;
  sessionId: string;
  workingDirectory: string;
  updatedAt: string;
};

export function SessionSearchDialog({
  open,
  query,
  projects,
  activeThreadId,
  onClose,
  onQueryChange,
  onSelectThread,
}: SessionSearchDialogProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  const entries = useMemo(() => buildSessionSearchEntries(projects, query), [projects, query]);

  useEffect(() => {
    if (!open) {
      setActiveIndex(0);
      return;
    }

    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [open, query]);

  if (!open) {
    return null;
  }

  const selectedEntry = entries[Math.min(activeIndex, Math.max(0, entries.length - 1))] ?? null;

  function handleSelect(entry: SessionSearchEntry) {
    onClose();
    void onSelectThread(entry.projectId, entry.threadId);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if ((event.ctrlKey || event.metaKey) && /^[1-9]$/.test(event.key)) {
      const targetIndex = Number.parseInt(event.key, 10) - 1;
      const targetEntry = entries[targetIndex];
      if (targetEntry) {
        event.preventDefault();
        handleSelect(targetEntry);
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, Math.max(0, entries.length - 1)));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === 'Enter' && selectedEntry) {
      event.preventDefault();
      handleSelect(selectedEntry);
    }
  }

  return (
    <div className="session-search-overlay" role="presentation" onClick={onClose}>
      <section
        className="session-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="搜索对话"
        onClick={(event) => event.stopPropagation()}
      >
        <label className="session-search-input-wrap" aria-label="搜索对话">
          <Search size={16} />
          <input
            autoFocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="搜索对话"
          />
        </label>

        <div className="session-search-section-title">
          {query.trim() ? '搜索结果' : '近期对话'}
        </div>

        <div className="session-search-results" role="listbox" aria-label="会话搜索结果">
          {entries.length === 0 ? (
            <div className="session-search-empty">
              {query.trim() ? '没有匹配的会话' : '当前还没有可切换的会话'}
            </div>
          ) : null}
          {entries.map((entry, index) => (
            <button
              key={entry.threadId}
              type="button"
              className={`session-search-result${index === activeIndex ? ' active' : ''}${entry.threadId === activeThreadId ? ' current' : ''}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => handleSelect(entry)}
            >
              <span className="session-search-result-title">{entry.title}</span>
              <span className="session-search-result-side">
                <span className="session-search-result-meta">{entry.projectName}</span>
                {index < 9 ? (
                  <kbd className="session-search-result-shortcut">{`Ctrl+${index + 1}`}</kbd>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function buildSessionSearchEntries(projects: ProjectSummary[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const entries: SessionSearchEntry[] = [];

  for (const project of projects) {
    for (const thread of project.threads) {
      const searchText = [
        thread.title,
        project.name,
        project.path,
        thread.sessionId,
        thread.workingDirectory,
      ]
        .join('\n')
        .toLowerCase();

      if (normalizedQuery && !searchText.includes(normalizedQuery)) {
        continue;
      }

      entries.push({
        threadId: thread.id,
        projectId: project.id,
        title: thread.title,
        projectName: project.name,
        sessionId: thread.sessionId,
        workingDirectory: thread.workingDirectory,
        updatedAt: thread.updatedAt,
      });
    }
  }

  return entries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
