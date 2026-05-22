const MIN_WORKBENCH_NAVIGATOR_WIDTH = 220;
const MAX_WORKBENCH_NAVIGATOR_WIDTH = 520;

export function clampWorkbenchNavigatorWidth(width: number) {
  return Math.min(MAX_WORKBENCH_NAVIGATOR_WIDTH, Math.max(MIN_WORKBENCH_NAVIGATOR_WIDTH, Math.round(width)));
}

export function buildWorkbenchFilesLayoutColumns(navigatorVisible: boolean, navigatorWidth: number) {
  if (!navigatorVisible) {
    return 'minmax(0, 1fr)';
  }

  return `minmax(0, 1fr) ${clampWorkbenchNavigatorWidth(navigatorWidth)}px`;
}

export { MIN_WORKBENCH_NAVIGATOR_WIDTH, MAX_WORKBENCH_NAVIGATOR_WIDTH };
