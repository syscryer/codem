import antigravityIcon from '../assets/app-icons/antigravity.png';
import cursorIcon from '../assets/app-icons/cursor.png';
import vscodeIcon from '../assets/app-icons/vscode.png';

const folderIcon = svgIcon(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='#f6c344' d='M3 6.5A2.5 2.5 0 0 1 5.5 4h4.2l2 2H18.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z'/><path fill='#e4a92c' d='M3 9h18v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z'/></svg>",
);
const terminalIcon = svgIcon(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect x='3' y='5' width='18' height='14' rx='3' fill='#1f2937'/><path d='m7 9 3 3-3 3' fill='none' stroke='#6ee7b7' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/><path d='M12 15h5' stroke='#93c5fd' stroke-width='1.8' stroke-linecap='round'/></svg>",
);
const gitBashIcon = svgIcon(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect x='4' y='4' width='16' height='16' rx='3' fill='#f05033' transform='rotate(45 12 12)'/><path d='M9 8.5 12 11.5m0 0 3-3m-3 3v4' fill='none' stroke='white' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/></svg>",
);
const wslIcon = svgIcon(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect x='4' y='4' width='16' height='16' rx='4' fill='#0f172a'/><path d='M8 8h8v8H8z' fill='#4ade80'/><path d='M10 10h4v4h-4z' fill='#0f172a'/></svg>",
);
const visualStudioIcon = svgIcon(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='#8b5cf6' d='M4 8.5 8 6l6 6-6 6-4-2.5L9 12z'/><path fill='#a78bfa' d='M14 5.5 20 3v18l-6-2.5z'/></svg>",
);
const ideaIcon = jetBrainsIcon('IJ', '#ff3355', '#7c3aed');
const riderIcon = jetBrainsIcon('RD', '#f97316', '#7c3aed');
const pycharmIcon = jetBrainsIcon('PC', '#22c55e', '#0ea5e9');
const webstormIcon = jetBrainsIcon('WS', '#06b6d4', '#2563eb');

export const genericOpenAppIcon = svgIcon(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='#9ca3af' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'><rect x='4' y='4' width='16' height='16' rx='3'/><path d='M8 9h8M8 13h8M8 17h5'/></svg>",
);

export function getOpenAppIcon(id: string) {
  switch (id) {
    case 'vscode':
      return vscodeIcon;
    case 'cursor':
      return cursorIcon;
    case 'antigravity':
      return antigravityIcon;
    case 'visualstudio':
      return visualStudioIcon;
    case 'explorer':
      return folderIcon;
    case 'terminal':
      return terminalIcon;
    case 'git-bash':
      return gitBashIcon;
    case 'wsl':
      return wslIcon;
    case 'idea':
      return ideaIcon;
    case 'rider':
      return riderIcon;
    case 'pycharm':
      return pycharmIcon;
    case 'webstorm':
      return webstormIcon;
    default:
      return genericOpenAppIcon;
  }
}

function jetBrainsIcon(label: string, start: string, end: string) {
  return svgIcon(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><defs><linearGradient id='g' x1='4' y1='4' x2='20' y2='20'><stop stop-color='${start}'/><stop offset='1' stop-color='${end}'/></linearGradient></defs><rect x='3' y='3' width='18' height='18' rx='4' fill='url(#g)'/><rect x='6.5' y='6.5' width='11' height='11' fill='#000'/><text x='12' y='14.2' fill='white' font-family='Arial, sans-serif' font-size='5.5' font-weight='700' text-anchor='middle'>${label}</text></svg>`,
  );
}

function svgIcon(svg: string) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
