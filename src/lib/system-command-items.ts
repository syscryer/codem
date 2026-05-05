import type { SlashCardType, SystemCommandItem } from '../types';

export function createSystemCommandItem(command: string, title: string, cardType: SlashCardType): SystemCommandItem {
  return {
    id: crypto.randomUUID(),
    type: 'system-command',
    command,
    title,
    cardType,
    state: 'running',
  };
}

export function settleSystemCommandItem(
  item: SystemCommandItem,
  next: Pick<SystemCommandItem, 'state' | 'summary' | 'details' | 'errorMessage'>,
): SystemCommandItem {
  return {
    ...item,
    ...next,
  };
}
