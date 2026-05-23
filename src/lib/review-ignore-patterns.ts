export const DEFAULT_WORKBENCH_IGNORE_PATTERNS = Object.freeze([
  '.idea',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.cache',
  'logs',
  '.ds_store',
  'thumbs.db',
  '*.log',
  '*.pyc',
  '*.pyo',
  '*.tmp',
  '*.temp',
  '*.swp',
]);

export function cloneDefaultWorkbenchIgnorePatterns() {
  return [...DEFAULT_WORKBENCH_IGNORE_PATTERNS];
}

export function mergeWorkbenchIgnorePatterns(patterns: readonly string[]) {
  const merged: string[] = [];
  const seen = new Set<string>();

  patterns.forEach((pattern) => {
    const normalizedPattern = pattern.trim();
    if (!normalizedPattern || seen.has(normalizedPattern)) {
      return;
    }
    seen.add(normalizedPattern);
    merged.push(normalizedPattern);
  });

  return merged;
}
