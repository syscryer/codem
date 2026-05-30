// 桌面端拖拽 / 原生文件框拿到的真实磁盘路径处理工具。
// 设计参考开源项目 desktop-cc-gui（MIT）的 pathValidation / filePathReferences，
// 并适配 CodeM 的附件数据模型：只做安全过滤 + 规范化 + 去重，不限制文件类型。

const MAX_PATH_LENGTH = 4096;

// 拒绝明显指向敏感文件 / 目录的路径，避免误把凭据、密钥当普通附件发出去。
const SENSITIVE_PATH_PATTERNS = [
  '/etc/passwd',
  '/etc/shadow',
  '/proc/',
  '/sys/',
  '/.ssh/',
  '/.aws/',
  '/.gnupg/',
  '/.kube/',
];

// 单独匹配 .env（含 .env.local 等），避免泄露环境变量文件。
const SENSITIVE_BASENAME_PATTERN = /(^|[/\\])\.env(\.|$)/i;

export function validateDesktopFilePath(filePath: string): string | null {
  const trimmed = filePath.trim();
  if (!trimmed || trimmed.length > MAX_PATH_LENGTH) {
    return null;
  }

  const normalized = trimmed.replace(/\\/g, '/');

  // 拒绝目录穿越。
  if (normalized.includes('/../') || normalized.startsWith('../') || normalized.endsWith('/..')) {
    return null;
  }

  const lower = normalized.toLowerCase();
  if (SENSITIVE_PATH_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return null;
  }

  if (SENSITIVE_BASENAME_PATTERN.test(normalized)) {
    return null;
  }

  return trimmed;
}

// 用于去重的归一化形式：统一斜杠，Windows 盘符小写。
export function normalizeDesktopPathForComparison(filePath: string): string {
  const trimmed = filePath.trim();
  if (!trimmed) {
    return '';
  }

  let normalized = trimmed.replace(/\\/g, '/');
  const driveMatch = normalized.match(/^([a-zA-Z]):(\/|$)/);
  if (driveMatch) {
    normalized = `${(driveMatch[1] ?? '').toLowerCase()}:${normalized.slice(2)}`;
  }
  return normalized;
}

export function getDesktopPathBasename(filePath: string): string {
  return (
    filePath
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean)
      .pop() ?? filePath
  );
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

export function isDesktopImagePath(filePath: string): boolean {
  const extension = getDesktopPathBasename(filePath).split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.has(extension);
}

// 对一组原始路径做校验 + 去重，返回安全可用的绝对路径列表。
export function dedupeAndValidateDesktopPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawPath of paths) {
    const validated = validateDesktopFilePath(rawPath);
    if (!validated) {
      continue;
    }
    const dedupeKey = normalizeDesktopPathForComparison(validated);
    if (!dedupeKey || seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    result.push(validated);
  }

  return result;
}
