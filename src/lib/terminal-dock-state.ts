export type TerminalDockBodyKind = 'terminal' | 'extra' | 'unavailable';
export type TerminalDockPanelId = 'terminal' | 'git-history';

export function isTerminalDockActive({
  isOpen,
  activePanelId,
}: {
  isOpen: boolean;
  activePanelId?: string | null;
}) {
  return isOpen && (activePanelId ?? 'terminal') === 'terminal';
}

export function shouldRenderTerminalDock({
  isOpen,
  terminalAvailable,
  extraPanelIds,
}: {
  isOpen: boolean;
  terminalAvailable: boolean;
  extraPanelIds: string[];
}) {
  return isOpen && (terminalAvailable || extraPanelIds.length > 0);
}

export function resolveTerminalDockBodyKind({
  terminalAvailable,
  activePanelId,
  extraPanelIds,
}: {
  terminalAvailable: boolean;
  activePanelId?: string | null;
  extraPanelIds: string[];
}): TerminalDockBodyKind {
  if (activePanelId && extraPanelIds.includes(activePanelId)) {
    return 'extra';
  }

  return terminalAvailable ? 'terminal' : 'unavailable';
}

export function resolveTerminalDockPanelIdOnRun() {
  return 'terminal' as TerminalDockPanelId;
}
