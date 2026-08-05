import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';
import { renderMarkdownImage, type MarkdownImagePreviewPayload } from '../lib/markdown-image';
import { renderMarkdownLink, type MarkdownLocalFileMenuTarget } from '../lib/markdown-link';
import { remarkLocalFileLinks } from '../lib/markdown-local-file-links';

type MarkdownContentProps = {
  content: string;
  className?: string;
  onPreviewImage?: (preview: MarkdownImagePreviewPayload) => void;
  onOpenLocalFile?: (path: string) => void;
  onOpenLocalFileContextMenu?: (target: MarkdownLocalFileMenuTarget) => void;
  onOpenWebUrl?: (url: string) => void;
  onOpenWebContextMenu?: (target: { url: string; x: number; y: number }) => void;
};

export const MarkdownContent = memo(function MarkdownContent({
  content,
  className = '',
  onPreviewImage,
  onOpenLocalFile,
  onOpenLocalFileContextMenu,
  onOpenWebUrl,
  onOpenWebContextMenu,
}: MarkdownContentProps) {
  const deferredContent = useDeferredValue(content);
  const markdownComponents = useMemo(() => ({
    a({ href, title, children }: { href?: string; title?: string; children?: ReactNode }) {
      return renderMarkdownLink({
        href,
        title,
        children,
        onOpenLocalFile,
        onOpenLocalFileContextMenu,
        onOpenWebUrl,
        onOpenWebContextMenu,
      });
    },
    img({ src, alt, title }: { src?: string; alt?: string; title?: string }) {
      return renderMarkdownImage({ src, alt, title, onPreview: onPreviewImage });
    },
    pre: MarkdownCodeBlock,
  }), [
    onOpenLocalFile,
    onOpenLocalFileContextMenu,
    onOpenWebContextMenu,
    onOpenWebUrl,
    onPreviewImage,
  ]);

  return (
    <div className={`message-body markdown-body ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkLocalFileLinks]}
        components={markdownComponents}
      >
        {deferredContent}
      </ReactMarkdown>
    </div>
  );
});

function MarkdownCodeBlock({ children }: { children?: ReactNode }) {
  const text = extractCodeText(children);
  return (
    <div className="code-block-shell">
      <pre>{children}</pre>
      <MarkdownCodeCopyButton text={text} />
    </div>
  );
}

function MarkdownCodeCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }
  }, []);

  async function handleCopy() {
    if (!text.trim()) {
      return;
    }

    await navigator.clipboard.writeText(text);
    setCopied(true);
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      setCopied(false);
      timerRef.current = null;
    }, 1400);
  }

  const title = copied ? '已复制' : '复制代码';
  return (
    <button
      type="button"
      className={`inline-copy-button code-copy-button${copied ? ' copied' : ''}`}
      title={title}
      aria-label={title}
      disabled={!text.trim()}
      onClick={() => void handleCopy()}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

function extractCodeText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(extractCodeText).join('');
  }
  if (value && typeof value === 'object' && 'props' in value) {
    const props = (value as { props?: { children?: unknown } }).props;
    return extractCodeText(props?.children);
  }
  return '';
}
