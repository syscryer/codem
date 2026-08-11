import { useEffect, useState, type ImgHTMLAttributes } from 'react';

const API_IMAGE_PREVIEW_PATHS = new Set([
  '/api/system/image-preview',
  '/api/system/attachments/image-preview',
]);

export function isAuthenticatedApiImage(src: string) {
  try {
    return API_IMAGE_PREVIEW_PATHS.has(new URL(src, 'http://localhost').pathname);
  } catch {
    return false;
  }
}

export function AuthenticatedImage({ src, alt, className, style, onLoad, ...props }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const requiresFetch = isAuthenticatedApiImage(src);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(requiresFetch ? null : src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (!requiresFetch) {
      setResolvedSrc(src);
      return;
    }

    const controller = new AbortController();
    let objectUrl: string | null = null;
    setResolvedSrc(null);

    void fetch(src, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`图片预览请求失败: ${response.status}`);
        }
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) {
          throw new Error('图片预览响应类型无效');
        }
        objectUrl = URL.createObjectURL(blob);
        setResolvedSrc(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFailed(true);
        }
      });

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [requiresFetch, src]);

  if (!resolvedSrc) {
    return (
      <span
        className={`${className ?? ''} authenticated-image-placeholder`.trim()}
        style={style}
        role="img"
        aria-label={`${alt || '图片'}${failed ? '加载失败' : '加载中'}`}
        data-image-state={failed ? 'error' : 'loading'}
      />
    );
  }

  return <img {...props} src={resolvedSrc} alt={alt} className={className} style={style} onLoad={onLoad} />;
}
