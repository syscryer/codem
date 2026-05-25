import { useEffect } from 'react';
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
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="dialog-backdrop image-preview-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog-card image-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={preview.alt || preview.title || '图片预览'}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="image-preview-close" aria-label="关闭图片预览" onClick={onClose}>
          <X size={18} />
        </button>
        <div className="image-preview-stage">
          <img src={preview.src} alt={preview.alt} className="image-preview-image" />
        </div>
        {preview.title || preview.alt ? (
          <div className="image-preview-meta">
            <strong>{preview.title || preview.alt}</strong>
          </div>
        ) : null}
      </div>
    </div>
  );
}
