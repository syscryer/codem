import { readFileSync } from 'node:fs';

const iconResolverSource = readFileSync('src/lib/workbench-file-icons.ts', 'utf8');
const iconComponentSource = readFileSync('src/components/WorkbenchFileIcon.tsx', 'utf8');
const rightWorkbenchSource = readFileSync('src/components/RightWorkbench.tsx', 'utf8');
const gitHistorySource = readFileSync('src/components/GitHistoryPanel.tsx', 'utf8');
const composerSource = readFileSync('src/components/Composer.tsx', 'utf8');
const tauriConfigSource = readFileSync('src-tauri/tauri.conf.json', 'utf8');

const failures = [];
const forbidden = ['https://', 'http://', 'cdn.jsdelivr.net', 'vscode-icons-js', '<img'];

for (const value of forbidden) {
  if (iconResolverSource.includes(value)) {
    failures.push(`workbench-file-icons.ts must not contain ${value}`);
  }
  if (iconComponentSource.includes(value)) {
    failures.push(`WorkbenchFileIcon.tsx must not contain ${value}`);
  }
}

for (const [name, source] of [
  ['RightWorkbench.tsx', rightWorkbenchSource],
  ['GitHistoryPanel.tsx', gitHistorySource],
  ['Composer.tsx', composerSource],
]) {
  if (!source.includes('WorkbenchFileIcon')) {
    failures.push(`${name} must use WorkbenchFileIcon`);
  }
}

if (tauriConfigSource.includes('cdn.jsdelivr.net')) {
  failures.push('Tauri CSP must not allow jsDelivr for workbench file icons');
}

if (!iconComponentSource.includes('size = 18')) {
  failures.push('WorkbenchFileIcon must default to an 18px stable size');
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('workbench local icon source check passed');
