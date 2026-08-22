import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, Globe, RotateCw } from 'lucide-react';
import { openExternalUrl } from '../../lib/markdown-link';
import { normalizeBrowserAddressInput, pushBrowserHistoryEntry, resolveMobileBrowsableUrl } from '../lib/mobile-browser';

export type BrowserOpenRequest = { id: number; url: string };

export function BrowserPage({ pendingUrl }: { pendingUrl?: BrowserOpenRequest | null }) {
  const [entries, setEntries] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [addressDraft, setAddressDraft] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const handledRequestIdRef = useRef(-1);
  const currentUrl = entries[activeIndex] ?? null;
  const canGoBack = activeIndex > 0;
  const canGoForward = activeIndex < entries.length - 1;

  const navigateTo = (rawInput: string) => {
    const normalized = normalizeBrowserAddressInput(rawInput);
    if (!normalized) {
      setNotice('请输入有效的 http(s) 网址');
      return;
    }
    const next = resolveMobileBrowsableUrl(normalized) ?? normalized;
    const nextHistory = pushBrowserHistoryEntry(entries, activeIndex, next);
    setEntries(nextHistory.entries);
    setActiveIndex(nextHistory.activeIndex);
    setAddressDraft(next);
    setLoading(true);
    setNotice(null);
  };

  useEffect(() => {
    if (!pendingUrl || pendingUrl.id === handledRequestIdRef.current) return;
    handledRequestIdRef.current = pendingUrl.id;
    navigateTo(pendingUrl.url);
  }, [pendingUrl]);

  const step = (delta: number) => {
    const nextIndex = activeIndex + delta;
    if (nextIndex < 0 || nextIndex >= entries.length) {
      return;
    }
    setActiveIndex(nextIndex);
    setAddressDraft(entries[nextIndex]);
    setLoading(true);
    setNotice(null);
  };

  const reload = () => {
    if (!currentUrl) {
      return;
    }
    setReloadKey((key) => key + 1);
    setLoading(true);
    setNotice(null);
  };

  const openExternally = async () => {
    if (!currentUrl || !await openExternalUrl(currentUrl)) {
      setNotice('无法唤起系统浏览器');
    }
  };

  return (
    <div className="mobile-browser-page">
      <header className="mobile-browser-header">
        <button type="button" className="mobile-browser-icon-button" onClick={() => step(-1)} disabled={!canGoBack} aria-label="后退" title="后退">
          <ArrowLeft size={17} />
        </button>
        <button type="button" className="mobile-browser-icon-button" onClick={() => step(1)} disabled={!canGoForward} aria-label="前进" title="前进">
          <ArrowRight size={17} />
        </button>
        <form
          className="mobile-browser-address"
          onSubmit={(event) => {
            event.preventDefault();
            navigateTo(addressDraft);
          }}
        >
          <Globe size={15} aria-hidden="true" />
          <input
            value={addressDraft}
            onChange={(event) => setAddressDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              navigateTo(addressDraft);
            }}
            placeholder="输入网址"
            inputMode="url"
            enterKeyHint="go"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label="网址"
          />
        </form>
        <button type="button" className="mobile-browser-icon-button" onClick={reload} disabled={!currentUrl} aria-label="刷新" title="刷新">
          <RotateCw size={18} />
        </button>
        <button type="button" className="mobile-browser-icon-button mobile-browser-external" onClick={() => void openExternally()} disabled={!currentUrl} aria-label="系统浏览器" title="在系统浏览器打开">
          <ExternalLink size={17} />
        </button>
        <span className="mobile-browser-status" aria-live="polite">
          {notice
            ?? (loading && currentUrl ? '加载中…'
              : currentUrl ? '页面空白多为网站禁止内嵌，可改用系统浏览器打开'
                : '输入网址开始浏览')}
        </span>
      </header>

      <main className="mobile-browser-frame" aria-label="网页内容">
        {currentUrl ? (
          <iframe
            key={`${activeIndex}-${reloadKey}`}
            src={currentUrl}
            title="内嵌浏览器"
            scrolling="yes"
            onLoad={() => setLoading(false)}
          />
        ) : (
          <div className="mobile-browser-empty">
            <Globe size={30} aria-hidden="true" />
            <p>在任务会话中点击链接，或在上方输入网址</p>
          </div>
        )}
      </main>
    </div>
  );
}
