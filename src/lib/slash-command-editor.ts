import type { SlashCommand } from '../types';

export type SlashLineContext = {
  query: string;
  lineStart: number;
  lineEnd: number;
  commandText: string;
};

export type TextReplacementResult = {
  text: string;
  selectionStart: number;
  selectionEnd: number;
};

export type SlashCommandNavigationDirection = 'next' | 'previous';

export function getCurrentLineSlashContext(text: string, selectionStart: number): SlashLineContext | null {
  const safeSelectionStart = clampSelection(selectionStart, text.length);
  const lineStart = findLineStart(text, safeSelectionStart);
  const lineEnd = findLineEnd(text, safeSelectionStart);
  const linePrefix = text.slice(lineStart, safeSelectionStart);
  const matched = /^(\s*)\/([^\s]*)$/.exec(linePrefix);
  if (!matched) {
    return null;
  }

  return {
    query: matched[2],
    lineStart,
    lineEnd,
    commandText: `/${matched[2]}`,
  };
}

export function replaceCurrentLineWithText(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  replacement: string,
): TextReplacementResult {
  const safeSelectionStart = clampSelection(selectionStart, text.length);
  const safeSelectionEnd = clampSelection(selectionEnd, text.length);
  const lineStart = findLineStart(text, safeSelectionStart);
  const lineEnd = findLineEnd(text, safeSelectionEnd);
  const nextText = `${text.slice(0, lineStart)}${replacement}${text.slice(lineEnd)}`;
  const nextSelectionStart = lineStart + replacement.length;
  return {
    text: nextText,
    selectionStart: nextSelectionStart,
    selectionEnd: nextSelectionStart,
  };
}

export function applySlashCommandSelection(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  command: SlashCommand,
): TextReplacementResult {
  const replacement = buildSlashCommandReplacement(command);
  return replaceCurrentLineWithText(text, selectionStart, selectionEnd, replacement);
}

export function getNextSlashCommandIndex(
  currentIndex: number,
  direction: SlashCommandNavigationDirection,
  commandCount: number,
) {
  if (commandCount <= 0) {
    return -1;
  }

  if (direction === 'next') {
    return currentIndex >= 0 ? (currentIndex + 1) % commandCount : 0;
  }

  return currentIndex >= 0 ? (currentIndex - 1 + commandCount) % commandCount : commandCount - 1;
}

function buildSlashCommandReplacement(command: SlashCommand) {
  if (command.action === 'insert-template') {
    return command.template || command.slash;
  }

  if (command.action === 'local-action') {
    return command.slash;
  }

  return `${command.slash} `;
}

function findLineStart(text: string, selectionStart: number) {
  const previousLineBreak = text.lastIndexOf('\n', Math.max(0, selectionStart - 1));
  return previousLineBreak === -1 ? 0 : previousLineBreak + 1;
}

function findLineEnd(text: string, selectionEnd: number) {
  const nextLineBreak = text.indexOf('\n', selectionEnd);
  return nextLineBreak === -1 ? text.length : nextLineBreak;
}

function clampSelection(selection: number, textLength: number) {
  if (!Number.isFinite(selection)) {
    return textLength;
  }

  return Math.min(textLength, Math.max(0, selection));
}
