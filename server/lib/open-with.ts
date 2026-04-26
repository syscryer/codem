import type { OpenWithSettings } from './settings-store.js';

export type EditorLaunchRequest = {
  candidates: string[];
  args: string[];
};

export function createEditorLaunchRequest(
  openWith: OpenWithSettings,
  environment: NodeJS.ProcessEnv,
): EditorLaunchRequest {
  if (openWith.target === 'cursor') {
    return { candidates: ['cursor'], args: [] };
  }

  if (openWith.target === 'vscode') {
    return { candidates: ['code'], args: [] };
  }

  if (openWith.target === 'custom') {
    return {
      candidates: openWith.customCommand ? [openWith.customCommand] : [],
      args: parseOpenWithArgs(openWith.customArgs),
    };
  }

  return {
    candidates: [
      environment.CODEM_EDITOR,
      environment.VISUAL,
      environment.EDITOR,
      'cursor',
      'code',
    ].filter((value): value is string => Boolean(value?.trim())),
    args: [],
  };
}

export function parseOpenWithArgs(value: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if ((character === '"' || character === "'") && !quote) {
      quote = character;
      continue;
    }

    if (quote && character === quote) {
      quote = null;
      continue;
    }

    if (!quote && /\s/.test(character)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += character;
  }

  if (current) {
    args.push(current);
  }

  return args;
}
