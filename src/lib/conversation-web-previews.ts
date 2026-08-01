const WEB_URL_CANDIDATE = /https?:\/\/[^\s<>"'`，。；！？、]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

export function extractLocalWebPreviewUrls(contents: readonly string[]): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const content of contents) {
    for (const match of content.matchAll(WEB_URL_CANDIDATE)) {
      const candidate = trimMarkdownUrlCandidate(match[0]);
      try {
        const url = new URL(candidate);
        const hostname = url.hostname.toLowerCase();
        const local = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
        if (!local || url.username || url.password) continue;

        const normalized = url.toString();
        if (seen.has(normalized)) continue;

        seen.add(normalized);
        urls.push(normalized);
      } catch {
        continue;
      }
    }
  }

  return urls;
}

function trimMarkdownUrlCandidate(value: string) {
  let result = value.replace(TRAILING_PUNCTUATION, '');
  result = trimUnmatchedClosingDelimiter(result, '(', ')');
  result = trimUnmatchedClosingDelimiter(result, '[', ']');
  return trimUnmatchedClosingDelimiter(result, '{', '}');
}

function trimUnmatchedClosingDelimiter(value: string, opening: string, closing: string) {
  let result = value;
  while (result.endsWith(closing) && count(result, closing) > count(result, opening)) {
    result = result.slice(0, -1);
  }
  return result;
}

function count(value: string, token: string) {
  return Array.from(value).filter((character) => character === token).length;
}
