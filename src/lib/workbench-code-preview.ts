export const WORKBENCH_CODE_LINE_HEIGHT = 21;
export const WORKBENCH_CODE_OVERSCAN = 24;
export const WORKBENCH_LARGE_FILE_LINE_THRESHOLD = 1200;
export const WORKBENCH_LARGE_FILE_CHAR_THRESHOLD = 120000;

export function shouldUseLargeFilePreview(content: string, lineCount: number) {
  return (
    lineCount > WORKBENCH_LARGE_FILE_LINE_THRESHOLD ||
    content.length > WORKBENCH_LARGE_FILE_CHAR_THRESHOLD
  );
}

export function getWorkbenchVisibleLineRange(
  lineCount: number,
  scrollTop: number,
  viewportHeight: number,
) {
  if (lineCount <= 0) {
    return { start: 0, end: 0 };
  }

  const visibleCount = Math.max(1, Math.ceil(viewportHeight / WORKBENCH_CODE_LINE_HEIGHT));
  const start = Math.max(0, Math.floor(scrollTop / WORKBENCH_CODE_LINE_HEIGHT) - WORKBENCH_CODE_OVERSCAN);
  const end = Math.min(
    lineCount,
    start + visibleCount + WORKBENCH_CODE_OVERSCAN * 2,
  );

  return { start, end };
}
