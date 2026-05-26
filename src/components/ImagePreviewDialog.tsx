import { useEffect, useState, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export type ImagePreviewItem = {
  src: string;
  alt: string;
  title?: string;
};

export function ImagePreviewDialog({
  preview,
  onClose,
}: {
  preview: ImagePreviewItem;
  onClose: () => void;
}) {
  const [container, setContainer] = useState<Element | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    // 挂到 .codex-desktop 末尾：原本 dialog 渲染在 ConversationTurn 内部时，
    // 会被 conversation/right-workbench 等祖先创建的 stacking context 锁住，
    // 让 fixed 实际只覆盖右栏；portal 到 codex-desktop 后变成 sidebar / 菜单
    // 的兄弟节点，z-index 才能真正生效。codex-desktop 上挂着主题 CSS 变量，
    // dialog 也跟着继承到正确的明暗主题。
    const node = document.querySelector('.codex-desktop') ?? document.body;
    setContainer(node);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    setImageSize(null);
  }, [preview.src]);

  function handleImageLoad(event: SyntheticEvent<HTMLImageElement>) {
    const image = event.currentTarget;
    const maxWidth = Math.max(160, window.innerWidth - 100);
    const maxHeight = Math.max(160, window.innerHeight - 140);
    const nextWidth = Math.min(image.naturalWidth, maxWidth);
    const nextHeight = Math.min(image.naturalHeight, maxHeight);

    if (image.naturalWidth > maxWidth || image.naturalHeight > maxHeight) {
      const scale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
      setImageSize({
        width: Math.max(1, Math.round(image.naturalWidth * scale)),
        height: Math.max(1, Math.round(image.naturalHeight * scale)),
      });
      return;
    }

    setImageSize({
      width: nextWidth,
      height: nextHeight,
    });
  }

  if (!container) {
    return null;
  }

  return createPortal(
    <div className="dialog-backdrop image-preview-backdrop" role="presentation" onClick={onClose}>
      <div
        className="image-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={preview.alt || preview.title || '图片预览'}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="image-preview-close" aria-label="关闭图片预览" onClick={onClose}>
          <X size={18} />
        </button>
        <div className="image-preview-stage">
          <img
            src={preview.src}
            alt={preview.alt}
            className="image-preview-image"
            onLoad={handleImageLoad}
            style={imageSize ? { width: `${imageSize.width}px`, height: `${imageSize.height}px` } : undefined}
          />
        </div>
        {preview.title || preview.alt ? (
          <div className="image-preview-meta">
            <strong>{preview.title || preview.alt}</strong>
          </div>
        ) : null}
      </div>
    </div>,
    container,
  );
}
