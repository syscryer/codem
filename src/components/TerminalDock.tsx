import '@xterm/xterm/css/xterm.css';

import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XtermTerminal } from '@xterm/xterm';
import { Plus, TerminalSquare, X } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  closePtySession,
  ensurePtySession,
  isTerminalBridgeAvailable,
  onPtyOutput,
  resizePtySession,
  writePtyInput,
} from '../lib/terminal-bridge';

const OPEN_STORAGE_KEY = 'codem::terminal-dock-open';
const HEIGHT_STORAGE_KEY = 'codem::terminal-dock-height';
const TABS_STORAGE_KEY = 'codem::terminal-dock-tabs';
const ACTIVE_TAB_STORAGE_KEY = 'codem::terminal-dock-active-tab';
const DEFAULT_HEIGHT = 300;
const MIN_HEIGHT = 180;
const MAX_HEIGHT = 560;
const MAX_BUFFER_LENGTH = 80_000;

type DockTerminalTab = {
  id: string;
  title: string;
  cwd: string | null;
};

type TerminalWorkspace = {
  id: string;
  name: string;
  path: string;
};

export type TerminalRunRequest = {
  id: number;
  command: string;
  cwd: string | null;
  title?: string;
};

function createTerminalId() {
  return `codem-terminal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readStoredTabs(): DockTerminalTab[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(TABS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as DockTerminalTab[];
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item?.id === 'string' && typeof item?.title === 'string')
      : [];
  } catch {
    return [];
  }
}

function readStoredActiveTabId() {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
}

function persistTabs(tabs: DockTerminalTab[], activeTabId: string | null) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(tabs));
  if (activeTabId) {
    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTabId);
  } else {
    window.localStorage.removeItem(ACTIVE_TAB_STORAGE_KEY);
  }
}

function nextTerminalTitle(tabs: DockTerminalTab[]) {
  const numbers = tabs
    .map((tab) => {
      const match = tab.title.match(/^终端\s*(\d+)$/);
      return match ? Number.parseInt(match[1] ?? '', 10) : Number.NaN;
    })
    .filter((value) => Number.isFinite(value));
  const next = numbers.length ? Math.max(...numbers) + 1 : 1;
  return `终端 ${next}`;
}

function createTab(defaults?: { title?: string; cwd?: string | null }): DockTerminalTab {
  return {
    id: createTerminalId(),
    title: defaults?.title ?? '终端 1',
    cwd: defaults?.cwd ?? null,
  };
}

function trimBuffer(value: string) {
  return value.length > MAX_BUFFER_LENGTH ? value.slice(value.length - MAX_BUFFER_LENGTH) : value;
}

function XtermSurface({
  terminalTabId,
  cwd,
  initialContent,
  commandRequest,
  onData,
  onCommandHandled,
}: {
  terminalTabId: string;
  cwd: string | null;
  initialContent: string;
  commandRequest: TerminalRunRequest | null;
  onData: (tabId: string, data: string) => void;
  onCommandHandled: (requestId: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XtermTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initialContentRef = useRef(initialContent);

  useEffect(() => {
    initialContentRef.current = initialContent;
  }, [initialContent]);

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    const terminal = new XtermTerminal({
      fontFamily: 'ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.45,
      cursorBlink: true,
      allowTransparency: true,
      theme: {
        background: '#ffffff',
        foreground: '#30343b',
        cursor: '#202124',
        selectionBackground: 'rgba(37, 99, 235, 0.18)',
        black: '#202124',
        blue: '#2563eb',
        cyan: '#0891b2',
        green: '#188038',
        magenta: '#7c3aed',
        red: '#d93025',
        white: '#f8fafc',
        yellow: '#b7791f',
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(hostRef.current);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    if (initialContentRef.current) {
      terminal.write(initialContentRef.current);
    }

    const dataDisposable = terminal.onData((data) => {
      void writePtyInput({ terminalTabId, data });
    });

    void ensurePtySession({
      terminalTabId,
      cwd,
      cols: terminal.cols,
      rows: terminal.rows,
    });

    const resizeObserver = new ResizeObserver(() => {
      if (!terminalRef.current || !fitAddonRef.current) {
        return;
      }
      fitAddonRef.current.fit();
      void resizePtySession({
        terminalTabId,
        cols: terminalRef.current.cols,
        rows: terminalRef.current.rows,
      });
    });
    resizeObserver.observe(hostRef.current);

    return () => {
      resizeObserver.disconnect();
      dataDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [cwd, terminalTabId]);

  useEffect(() => {
    const unlistenPromise = onPtyOutput((event) => {
      if (event.terminalTabId !== terminalTabId) {
        return;
      }
      onData(terminalTabId, event.data);
      terminalRef.current?.write(event.data);
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [onData, terminalTabId]);

  useEffect(() => {
    if (!commandRequest) {
      return;
    }

    const timerId = window.setTimeout(() => {
      void writePtyInput({
        terminalTabId,
        data: `${commandRequest.command}\r`,
      });
      onCommandHandled(commandRequest.id);
    }, 140);

    return () => window.clearTimeout(timerId);
  }, [commandRequest, onCommandHandled, terminalTabId]);

  return <div ref={hostRef} className="terminal-xterm-host" />;
}

export function TerminalDock({
  isOpen,
  onToggleOpen,
  defaultWorkspace,
  runRequest,
}: {
  isOpen: boolean;
  onToggleOpen: () => void;
  defaultWorkspace: TerminalWorkspace | null;
  runRequest: TerminalRunRequest | null;
}) {
  const [height, setHeight] = useState<number>(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_HEIGHT;
    }

    const raw = window.localStorage.getItem(HEIGHT_STORAGE_KEY);
    const value = raw ? Number(raw) : DEFAULT_HEIGHT;
    return Number.isFinite(value) ? Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, value)) : DEFAULT_HEIGHT;
  });
  const [terminalTabs, setTerminalTabs] = useState<DockTerminalTab[]>(() => readStoredTabs());
  const [activeTerminalTabId, setActiveTerminalTabId] = useState<string | null>(() => readStoredActiveTabId());
  const cleanupRef = useRef<(() => void) | null>(null);
  const outputBuffersRef = useRef<Record<string, string>>({});
  const previousTabIdsRef = useRef<string[]>([]);
  const wasOpenRef = useRef(false);
  const handledRunRequestIdRef = useRef<number | null>(null);
  const [commandRequestsByTabId, setCommandRequestsByTabId] = useState<Record<string, TerminalRunRequest>>({});

  const activeTab = useMemo(
    () => terminalTabs.find((tab) => tab.id === activeTerminalTabId) ?? null,
    [activeTerminalTabId, terminalTabs],
  );

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (activeTerminalTabId && terminalTabs.some((tab) => tab.id === activeTerminalTabId)) {
      persistTabs(terminalTabs, activeTerminalTabId);
      return;
    }

    const fallbackId = terminalTabs[0]?.id ?? null;
    if (fallbackId !== activeTerminalTabId) {
      setActiveTerminalTabId(fallbackId);
      persistTabs(terminalTabs, fallbackId);
      return;
    }
    persistTabs(terminalTabs, fallbackId);
  }, [activeTerminalTabId, terminalTabs]);

  useEffect(() => {
    const openedNow = isOpen && !wasOpenRef.current;
    wasOpenRef.current = isOpen;
    if (!isOpen || terminalTabs.length > 0 || !openedNow) {
      return;
    }

    const nextTab = createTab({
      title: terminalTitleFromWorkspace(defaultWorkspace, '终端 1'),
      cwd: defaultWorkspace?.path ?? null,
    });
    setTerminalTabs([nextTab]);
    setActiveTerminalTabId(nextTab.id);
  }, [defaultWorkspace, isOpen, terminalTabs.length]);

  useEffect(() => {
    const previous = previousTabIdsRef.current;
    const current = terminalTabs.map((tab) => tab.id);
    const removed = previous.filter((id) => !current.includes(id));
    removed.forEach((id) => {
      delete outputBuffersRef.current[id];
      void closePtySession(id);
    });
    previousTabIdsRef.current = current;
  }, [terminalTabs]);

  useEffect(() => {
    if (!isOpen || !runRequest || handledRunRequestIdRef.current === runRequest.id) {
      return;
    }

    handledRunRequestIdRef.current = runRequest.id;
    const targetTab =
      terminalTabs.find((tab) => tab.cwd === runRequest.cwd) ??
      activeTab ??
      null;

    if (targetTab) {
      setActiveTerminalTabId(targetTab.id);
      setCommandRequestsByTabId((current) => ({ ...current, [targetTab.id]: runRequest }));
      return;
    }

    const nextTab = createTab({
      title: runRequest.title ?? terminalTitleFromWorkspace(defaultWorkspace, '终端 1'),
      cwd: runRequest.cwd,
    });
    setTerminalTabs((current) => [...current, nextTab]);
    setActiveTerminalTabId(nextTab.id);
    setCommandRequestsByTabId((current) => ({ ...current, [nextTab.id]: runRequest }));
  }, [activeTab, defaultWorkspace, isOpen, runRequest, terminalTabs]);

  function persistHeight(next: number) {
    setHeight(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(HEIGHT_STORAGE_KEY, String(next));
    }
  }

  function handleResizeStart(event: ReactMouseEvent) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    cleanupRef.current?.();

    const startY = event.clientY;
    const startHeight = height;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const handleMove = (moveEvent: MouseEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const next = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, startHeight + deltaY));
      persistHeight(next);
    };

    let completed = false;
    const finish = () => {
      if (completed) {
        return;
      }
      completed = true;
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', finish);
      window.removeEventListener('blur', finish);
      cleanupRef.current = null;
    };

    cleanupRef.current = finish;
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', finish);
    window.addEventListener('blur', finish);
  }

  function handleNewTerminal() {
    const nextTab = createTab({
      title: nextTerminalTitle(terminalTabs),
      cwd: defaultWorkspace?.path ?? activeTab?.cwd ?? null,
    });
    setTerminalTabs((current) => [...current, nextTab]);
    setActiveTerminalTabId(nextTab.id);
  }

  function handleCloseTab(tabId: string) {
    void closePtySession(tabId);
    delete outputBuffersRef.current[tabId];
    setTerminalTabs((current) => {
      const nextTabs = current.filter((tab) => tab.id !== tabId);
      setActiveTerminalTabId((currentActive) => {
        if (currentActive !== tabId) {
          return currentActive;
        }
        const closedIndex = current.findIndex((tab) => tab.id === tabId);
        return nextTabs[closedIndex]?.id ?? nextTabs[closedIndex - 1]?.id ?? nextTabs[0]?.id ?? null;
      });
      return nextTabs;
    });
  }

  function handleBufferData(tabId: string, data: string) {
    outputBuffersRef.current[tabId] = trimBuffer(`${outputBuffersRef.current[tabId] ?? ''}${data}`);
  }

  function handleCommandRequestHandled(tabId: string, requestId: number) {
    setCommandRequestsByTabId((current) => {
      if (current[tabId]?.id !== requestId) {
        return current;
      }
      const next = { ...current };
      delete next[tabId];
      return next;
    });
  }

  if (!isOpen) {
    return null;
  }

  if (!isTerminalBridgeAvailable()) {
    return (
      <section className="terminal-panel" style={{ height }}>
        <TerminalDockHeader onNewTerminal={handleNewTerminal} onToggleOpen={onToggleOpen} tabs={[]} />
        <div className="terminal-empty">终端仅在桌面版可用。</div>
      </section>
    );
  }

  return (
    <section className="terminal-panel" style={{ height }}>
      <div
        className="terminal-panel-resizer"
        role="separator"
        aria-orientation="horizontal"
        aria-label="调整终端高度"
        onMouseDown={handleResizeStart}
      />
      <TerminalDockHeader
        activeTerminalTabId={activeTerminalTabId}
        onCloseTab={handleCloseTab}
        onNewTerminal={handleNewTerminal}
        onSelectTab={setActiveTerminalTabId}
        onToggleOpen={onToggleOpen}
        tabs={terminalTabs}
      />
      <div className="terminal-body">
        <div className="terminal-surface">
          {activeTab ? (
            <XtermSurface
              terminalTabId={activeTab.id}
              cwd={activeTab.cwd}
              initialContent={outputBuffersRef.current[activeTab.id] ?? ''}
              commandRequest={commandRequestsByTabId[activeTab.id] ?? null}
              onData={handleBufferData}
              onCommandHandled={(requestId) => handleCommandRequestHandled(activeTab.id, requestId)}
            />
          ) : (
            <div className="terminal-empty">点击 + 创建一个终端。</div>
          )}
        </div>
      </div>
    </section>
  );
}

function TerminalDockHeader({
  activeTerminalTabId,
  tabs,
  onSelectTab,
  onCloseTab,
  onNewTerminal,
  onToggleOpen,
}: {
  activeTerminalTabId?: string | null;
  tabs: DockTerminalTab[];
  onSelectTab?: (tabId: string) => void;
  onCloseTab?: (tabId: string) => void;
  onNewTerminal: () => void;
  onToggleOpen: () => void;
}) {
  return (
    <div className="terminal-header">
      <div className="terminal-tabs" role="tablist" aria-label="终端标签">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTerminalTabId;
          return (
            <button
              key={tab.id}
              className={`terminal-tab${isActive ? ' active' : ''}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelectTab?.(tab.id)}
              title={tab.cwd ?? tab.title}
            >
              <TerminalSquare size={14} aria-hidden="true" />
              <span className="terminal-tab-label">{tab.cwd ?? tab.title}</span>
              <span
                className="terminal-tab-close"
                role="button"
                aria-label={`关闭 ${tab.title}`}
                onClick={(innerEvent) => {
                  innerEvent.stopPropagation();
                  onCloseTab?.(tab.id);
                }}
              >
                <X size={13} />
              </span>
            </button>
          );
        })}
        <button
          className="terminal-tab-add"
          type="button"
          onClick={onNewTerminal}
          aria-label="新建终端"
          title="新建终端"
        >
          <Plus size={17} />
        </button>
      </div>
      <button
        type="button"
        className="terminal-dock-toggle"
        onClick={onToggleOpen}
        aria-label="隐藏终端"
        title="隐藏终端"
      >
        <X size={18} />
      </button>
    </div>
  );
}

function terminalTitleFromWorkspace(workspace: TerminalWorkspace | null, fallback: string) {
  return workspace?.path || workspace?.name || fallback;
}

export function useTerminalDockState() {
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.localStorage.getItem(OPEN_STORAGE_KEY) === 'true';
  });

  function toggle() {
    setOpen((current) => {
      const next = !current;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(OPEN_STORAGE_KEY, String(next));
      }
      return next;
    });
  }

  function openDock() {
    setOpen(true);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(OPEN_STORAGE_KEY, 'true');
    }
  }

  return { open, toggle, openDock };
}
