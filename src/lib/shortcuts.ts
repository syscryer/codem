type KeyboardLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

const modifierKeys = new Set(['shift', 'control', 'ctrl', 'alt', 'meta', 'cmd', 'command']);
const keyLabels: Record<string, string> = {
  ' ': 'Space',
  space: 'Space',
  escape: 'Esc',
  esc: 'Esc',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
};

export function normalizeShortcutValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const parts = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .split('+')
    .map((part) => normalizeShortcutPart(part))
    .filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  const key = parts.at(-1);
  if (!key || modifierKeys.has(key)) {
    return null;
  }

  const modifiers = parts.slice(0, -1);
  if (!modifiers.some((part) => part === 'ctrl' || part === 'cmd' || part === 'alt')) {
    return null;
  }

  const normalizedModifiers = ['cmd', 'ctrl', 'alt', 'shift'].filter((modifier) => modifiers.includes(modifier));
  return [...normalizedModifiers, key].join('+');
}

export function buildShortcutValue(event: KeyboardLike): string | null {
  const key = normalizeKey(event.key);
  if (!key || modifierKeys.has(key)) {
    return null;
  }

  const parts: string[] = [];
  if (event.metaKey) {
    parts.push('cmd');
  }
  if (event.ctrlKey) {
    parts.push('ctrl');
  }
  if (event.altKey) {
    parts.push('alt');
  }
  if (event.shiftKey) {
    parts.push('shift');
  }

  if (!parts.some((part) => part === 'cmd' || part === 'ctrl' || part === 'alt')) {
    return null;
  }

  return [...parts, key].join('+');
}

export function matchesShortcut(event: KeyboardLike, value: string | null | undefined): boolean {
  const normalized = normalizeShortcutValue(value);
  if (!normalized) {
    return false;
  }

  const parts = normalized.split('+');
  const key = parts.at(-1);
  return (
    normalizeKey(event.key) === key &&
    event.metaKey === parts.includes('cmd') &&
    event.ctrlKey === parts.includes('ctrl') &&
    event.altKey === parts.includes('alt') &&
    event.shiftKey === parts.includes('shift')
  );
}

export function formatShortcut(value: string | null | undefined): string {
  const normalized = normalizeShortcutValue(value);
  if (!normalized) {
    return '未设置';
  }

  return normalized
    .split('+')
    .map((part) => {
      if (part === 'cmd') {
        return 'Cmd';
      }
      if (part === 'ctrl') {
        return 'Ctrl';
      }
      if (part === 'alt') {
        return 'Alt';
      }
      if (part === 'shift') {
        return 'Shift';
      }
      return keyLabels[part] ?? (part.length === 1 ? part.toUpperCase() : part);
    })
    .join('+');
}

function normalizeShortcutPart(value: string) {
  if (value === 'control') {
    return 'ctrl';
  }
  if (value === 'meta' || value === 'command') {
    return 'cmd';
  }
  return normalizeKey(value);
}

function normalizeKey(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === ' ') {
    return 'space';
  }
  if (normalized === 'esc') {
    return 'escape';
  }
  if (normalized === 'return') {
    return 'enter';
  }
  return normalized;
}
