const MIN_WORKBENCH_NAVIGATOR_WIDTH = 220;
const MAX_WORKBENCH_NAVIGATOR_WIDTH = 520;
const WORKBENCH_LAYOUT_COLUMNS_CSS_VAR = '--workbench-layout-columns';
const WORKBENCH_LAYOUT_COLUMNS_OVERRIDE_CSS_VAR = '--workbench-layout-columns-override';
const WORKBENCH_NAVIGATOR_WIDTH_CSS_VAR = '--workbench-navigator-width';
const WORKBENCH_NAVIGATOR_WIDTH_OVERRIDE_CSS_VAR = '--workbench-navigator-width-override';

export function clampWorkbenchNavigatorWidth(width: number) {
  return Math.min(MAX_WORKBENCH_NAVIGATOR_WIDTH, Math.max(MIN_WORKBENCH_NAVIGATOR_WIDTH, Math.round(width)));
}

export function buildWorkbenchFilesLayoutColumns(navigatorVisible: boolean, navigatorWidth: number) {
  if (!navigatorVisible) {
    return 'minmax(0, 1fr)';
  }

  return `minmax(0, 1fr) ${clampWorkbenchNavigatorWidth(navigatorWidth)}px`;
}

export function applyWorkbenchNavigatorWidthOverride(
  style: Pick<CSSStyleDeclaration, 'setProperty'>,
  navigatorWidth: number,
) {
  const clampedWidth = clampWorkbenchNavigatorWidth(navigatorWidth);
  style.setProperty(WORKBENCH_LAYOUT_COLUMNS_OVERRIDE_CSS_VAR, buildWorkbenchFilesLayoutColumns(true, clampedWidth));
  style.setProperty(WORKBENCH_NAVIGATOR_WIDTH_OVERRIDE_CSS_VAR, `${clampedWidth}px`);
}

export function clearWorkbenchNavigatorWidthOverride(
  style: Pick<CSSStyleDeclaration, 'removeProperty'>,
) {
  style.removeProperty(WORKBENCH_LAYOUT_COLUMNS_OVERRIDE_CSS_VAR);
  style.removeProperty(WORKBENCH_NAVIGATOR_WIDTH_OVERRIDE_CSS_VAR);
}

export {
  MAX_WORKBENCH_NAVIGATOR_WIDTH,
  MIN_WORKBENCH_NAVIGATOR_WIDTH,
  WORKBENCH_LAYOUT_COLUMNS_CSS_VAR,
  WORKBENCH_LAYOUT_COLUMNS_OVERRIDE_CSS_VAR,
  WORKBENCH_NAVIGATOR_WIDTH_CSS_VAR,
  WORKBENCH_NAVIGATOR_WIDTH_OVERRIDE_CSS_VAR,
};
