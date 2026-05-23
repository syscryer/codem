export type TerminalDockBodyKind = 'terminal' | 'extra' | 'unavailable';

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
