import type { WorkbenchPreviewSource } from '../types';

export function resolveWorkbenchNavigatorVisibility(
  manualVisibility: boolean | null,
  activePreviewSource?: WorkbenchPreviewSource,
) {
  if (manualVisibility !== null) {
    return manualVisibility;
  }

  if (activePreviewSource === 'conversation-output-file') {
    return false;
  }

  return true;
}
