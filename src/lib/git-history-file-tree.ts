import type { GitHistoryCommitFile } from '../types';

export type GitHistoryFileTreeNode =
  | {
      type: 'dir';
      name: string;
      path: string;
      children: GitHistoryFileTreeNode[];
    }
  | {
      type: 'file';
      name: string;
      path: string;
      file: GitHistoryCommitFile;
    };

type MutableTreeDir = {
  name: string;
  path: string;
  dirs: Map<string, MutableTreeDir>;
  files: GitHistoryCommitFile[];
};

export function buildGitHistoryFileTree(files: GitHistoryCommitFile[]): GitHistoryFileTreeNode[] {
  const root: MutableTreeDir = {
    name: '',
    path: '',
    dirs: new Map(),
    files: [],
  };

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    if (parts.length <= 1) {
      root.files.push(file);
      continue;
    }

    let current = root;
    let currentPath = '';
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index] ?? '';
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let next = current.dirs.get(part);
      if (!next) {
        next = {
          name: part,
          path: currentPath,
          dirs: new Map(),
          files: [],
        };
        current.dirs.set(part, next);
      }
      current = next;
    }
    current.files.push(file);
  }

  return materializeTree(root);
}

function materializeTree(root: MutableTreeDir): GitHistoryFileTreeNode[] {
  const dirNodes = Array.from(root.dirs.values())
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
    .map((dir) => ({
      type: 'dir' as const,
      name: dir.name,
      path: dir.path,
      children: materializeTree(dir),
    }));
  const fileNodes = root.files
    .slice()
    .sort((left, right) => left.path.localeCompare(right.path, 'zh-CN'))
    .map((file) => ({
      type: 'file' as const,
      name: file.path.split('/').filter(Boolean).at(-1) ?? file.path,
      path: file.path,
      file,
    }));
  return [...dirNodes, ...fileNodes];
}
