import { createElement, type ImgHTMLAttributes, type ReactElement } from 'react';

export type MarkdownImagePreviewPayload = {
  src: string;
  alt: string;
  title?: string;
};

type MarkdownImageProps = Pick<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'title'> & {
  onPreview?: (payload: MarkdownImagePreviewPayload) => void;
};

export function renderMarkdownImage(props: MarkdownImageProps): ReactElement {
  const alt = props.alt ?? '';
  const src = props.src ?? '';
  const imageElement = createElement('img', {
    src: props.src,
    alt,
    title: props.title,
    className: 'markdown-inline-image',
    loading: 'lazy',
    decoding: 'async',
  });

  if (!props.onPreview || !src.trim()) {
    return imageElement;
  }

  return createElement(
    'button',
    {
      type: 'button',
      className: 'markdown-inline-image-button',
      'aria-label': alt ? `预览图片：${alt}` : '预览图片',
      onClick: () =>
        props.onPreview?.({
          src,
          alt,
          title: props.title,
        }),
    },
    imageElement,
  );
}
