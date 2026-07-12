import { memo, type CSSProperties, type ReactNode } from 'react';

import {
  resolveWorkbenchFileIconDescriptor,
  type WorkbenchFileIconDescriptor,
} from '../lib/workbench-file-icons';

export type WorkbenchFileIconProps = {
  path: string;
  type: 'directory' | 'file';
  expanded?: boolean;
  className?: string;
  size?: number;
};

export const WorkbenchFileIcon = memo(function WorkbenchFileIcon({
  path,
  type,
  expanded = false,
  className,
  size = 18,
}: WorkbenchFileIconProps) {
  const icon = resolveWorkbenchFileIconDescriptor(path, type);
  const label = icon.label?.slice(0, 3);
  const style = {
    '--workbench-file-icon-accent': icon.accent,
    '--workbench-file-icon-size': `${size}px`,
  } as CSSProperties;
  const extraClassName = className ? ` ${className}` : '';

  if (icon.shape === 'folder') {
    return (
      <span
        className={`workbench-file-icon workbench-file-icon-folder${expanded ? ' is-open' : ''}${extraClassName}`}
        style={style}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" focusable="false">
          <path
            d="M2.8 7.7c0-1.05.85-1.9 1.9-1.9h5.15l1.72 1.9h7.73c1.05 0 1.9.85 1.9 1.9v7.75c0 1.05-.85 1.9-1.9 1.9H4.7a1.9 1.9 0 0 1-1.9-1.9V7.7Z"
            fill="var(--workbench-file-icon-tone)"
          />
          <path
            d="M2.8 9.7c0-1.05.85-1.9 1.9-1.9h14.6c1.05 0 1.9.85 1.9 1.9v.95H2.8V9.7Z"
            fill="var(--workbench-file-icon-accent)"
            opacity="0.9"
          />
          <path
            d="M2.8 10.4h18.4l-1.4 7.2a2 2 0 0 1-1.96 1.62H4.28a2 2 0 0 1-1.97-2.32l.49-6.5Z"
            fill="var(--workbench-file-icon-accent)"
            opacity={expanded ? '0.48' : '0.3'}
          />
        </svg>
      </span>
    );
  }

  return (
    <span
      className={`workbench-file-icon workbench-file-icon-file workbench-file-icon-${icon.kind}${extraClassName}`}
      style={style}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" focusable="false">
        <path
          d="M6.1 2.75h8.2l4.65 4.65v11.75a2.1 2.1 0 0 1-2.1 2.1H6.1A2.1 2.1 0 0 1 4 19.15V4.85a2.1 2.1 0 0 1 2.1-2.1Z"
          fill="var(--workbench-file-icon-tone)"
          stroke="var(--workbench-file-icon-accent)"
          strokeWidth="1.15"
        />
        <path
          d="M14.1 2.95V7.7h4.65"
          fill="none"
          stroke="var(--workbench-file-icon-accent)"
          strokeWidth="1.15"
        />
        {renderFileIconMark(icon)}
      </svg>
      {label ? <span className="workbench-file-icon-label">{label}</span> : null}
    </span>
  );
});

function renderFileIconMark(icon: WorkbenchFileIconDescriptor): ReactNode {
  if (icon.label) {
    return null;
  }

  switch (icon.shape) {
    case 'git':
      return (
        <path
          d="m9 9.2 6 6m-6-6 2.9-2.9m3.1 8.9 2.7-2.7"
          fill="none"
          stroke="var(--workbench-file-icon-accent)"
          strokeWidth="1.35"
          strokeLinecap="round"
        />
      );
    case 'docker':
      return (
        <>
          <rect x="7" y="11" width="2.5" height="2.1" rx=".3" fill="var(--workbench-file-icon-accent)" />
          <rect x="10" y="11" width="2.5" height="2.1" rx=".3" fill="var(--workbench-file-icon-accent)" />
          <rect x="13" y="11" width="2.5" height="2.1" rx=".3" fill="var(--workbench-file-icon-accent)" />
          <rect x="10" y="8.5" width="2.5" height="2.1" rx=".3" fill="var(--workbench-file-icon-accent)" />
          <path d="M6.8 14.1h10.6c-.45 2.1-2.2 3.25-4.8 3.25H9.4c-1.65 0-2.7-.95-2.6-3.25Z" fill="var(--workbench-file-icon-accent)" />
        </>
      );
    case 'react':
      return (
        <>
          <ellipse cx="11.6" cy="13.5" rx="5.2" ry="2.05" fill="none" stroke="var(--workbench-file-icon-accent)" strokeWidth="1" />
          <ellipse cx="11.6" cy="13.5" rx="5.2" ry="2.05" fill="none" stroke="var(--workbench-file-icon-accent)" strokeWidth="1" transform="rotate(60 11.6 13.5)" />
          <ellipse cx="11.6" cy="13.5" rx="5.2" ry="2.05" fill="none" stroke="var(--workbench-file-icon-accent)" strokeWidth="1" transform="rotate(120 11.6 13.5)" />
          <circle cx="11.6" cy="13.5" r="1" fill="var(--workbench-file-icon-accent)" />
        </>
      );
    default:
      return (
        <path
          d="M8.2 11.2h7.6M8.2 14.2h7.6M8.2 17.2h5"
          fill="none"
          stroke="var(--workbench-file-icon-accent)"
          strokeWidth="1.15"
          strokeLinecap="round"
          opacity="0.78"
        />
      );
  }
}
