import type { ReactNode, SVGProps } from 'react';

export type CodeMIconName = 'task' | 'search' | 'hub' | 'plugins' | 'automation';

type CodeMIconProps = SVGProps<SVGSVGElement> & {
  name: CodeMIconName;
  size?: number;
};

const paths: Record<CodeMIconName, ReactNode> = {
  task: (
    <>
      <rect x="4.5" y="4.5" width="15" height="15" rx="3" />
      <circle cx="8.5" cy="9" r=".75" />
      <circle cx="8.5" cy="15" r=".75" />
      <path d="M11.5 9h4M11.5 15h4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20.2 20.2-4.25-4.25" />
    </>
  ),
  hub: (
    <g transform="translate(2.1 2.1) scale(.825)" strokeWidth="2">
      <circle cx="12" cy="12" r="1" />
      <path d="M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5Z" />
      <path d="M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5Z" />
    </g>
  ),
  plugins: (
    <g transform="translate(2.1 2.1) scale(.825)" strokeWidth="2">
      <path d="M10 22V7a1 1 0 0 0-1-1H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 0 0-1-1H2" />
      <rect x="14" y="2" width="8" height="8" rx="1" />
    </g>
  ),
  automation: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.2V12h3.2" />
    </>
  ),
};

export function CodeMIcon({ name, size = 17, ...props }: CodeMIconProps) {
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
