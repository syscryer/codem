export function normalizeSessionId(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function resolvePromptSubmissionSessionId(
  threadSessionId: unknown,
  reuseSession = true,
) {
  if (!reuseSession) {
    return undefined;
  }

  return normalizeSessionId(threadSessionId);
}
