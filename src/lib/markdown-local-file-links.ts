import { classifyMarkdownLink } from './markdown-link';

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  url?: string;
};

const LOCAL_FILE_LINK_PATTERN = /\[([^\]\n]+)\]\(([^)\n]+)\)/g;

function looksLikeFilePath(value: string): boolean {
  const path = value.split(/[?#]/, 1)[0].trim();
  return (
    /^[a-zA-Z]:[\\/]/.test(path)
    || /[\\/]/.test(path)
    || /(?:^|[\\/])\.[^\\/\s]+$/.test(path)
    || /\.[^\\/\s.]+$/.test(path)
  );
}

function parseLocalFileLinks(value: string): MarkdownNode[] | null {
  const children: MarkdownNode[] = [];
  let lastIndex = 0;
  let converted = false;

  for (const match of value.matchAll(LOCAL_FILE_LINK_PATTERN)) {
    const index = match.index;
    const label = match[1];
    const rawTarget = match[2].trim();
    const target = classifyMarkdownLink(rawTarget);

    if (!looksLikeFilePath(rawTarget) || target.kind !== 'local-file') {
      continue;
    }

    if (index > lastIndex) {
      children.push({ type: 'text', value: value.slice(lastIndex, index) });
    }
    children.push({
      type: 'link',
      url: target.path,
      children: [{ type: 'text', value: label }],
    });
    lastIndex = index + match[0].length;
    converted = true;
  }

  if (!converted) {
    return null;
  }
  if (lastIndex < value.length) {
    children.push({ type: 'text', value: value.slice(lastIndex) });
  }
  return children;
}

function transformNode(node: MarkdownNode): void {
  if (!node.children || node.type === 'link' || node.type === 'linkReference') {
    return;
  }

  const nextChildren: MarkdownNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && child.value) {
      nextChildren.push(...(parseLocalFileLinks(child.value) ?? [child]));
      continue;
    }
    transformNode(child);
    nextChildren.push(child);
  }
  node.children = nextChildren;
}

export function remarkLocalFileLinks() {
  return (tree: MarkdownNode) => {
    transformNode(tree);
  };
}
