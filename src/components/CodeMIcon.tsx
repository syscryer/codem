import type { ReactNode, SVGProps } from 'react';

export type CodeMIconName = 'task' | 'search' | 'hub' | 'plugins' | 'automation';

type CodeMIconProps = SVGProps<SVGSVGElement> & {
  name: CodeMIconName;
  size?: number;
};

const paths: Record<CodeMIconName, ReactNode> = {
  task: (
    <>
      <path d="M5 4.5h9.5L19 9v10.5H5z" />
      <path d="M14.5 4.5V9H19M8 12h8M8 15h5" />
      <path d="M18.5 13.5v4M16.5 15.5h4" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path d="m15 15 4.5 4.5M8 10.5h5" />
    </>
  ),
  hub: (
    <>
      <rect x="9" y="3.5" width="6" height="5" rx="1.5" />
      <rect x="3.5" y="15.5" width="6" height="5" rx="1.5" />
      <rect x="14.5" y="15.5" width="6" height="5" rx="1.5" />
      <path d="M12 8.5v3M6.5 15.5v-2h11v2" />
    </>
  ),
  plugins: (
    <>
      <path d="M4 7.5h5v-3h3v3h3v3h-3v3h-3v-3H4z" />
      <path d="M12 13.5h3v-3h5v5h-3v3h-5z" />
    </>
  ),
  automation: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5v4.8l3 1.8M12 2v2M22 12h-2M12 22v-2M2 12h2" />
    </>
  ),
};

export function CodeMIcon({ name, size = 16, ...props }: CodeMIconProps) {
  return (
    <svg
      {...props}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
