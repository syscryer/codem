import path from 'node:path';
import type { OpenAppTarget, OpenWithSettings } from './settings-store.js';

export type CommandResolver = (command: string) => string;

type BuiltinOpenTarget = {
  id: string;
  label: string;
  kind: OpenAppTarget['kind'];
  candidates: string[];
  args?: string[];
};

export type OpenTargetLaunch = {
  command: string;
  args: string[];
};

const builtinOpenTargets: BuiltinOpenTarget[] = [
  {
    id: 'vscode',
    label: 'VS Code',
    kind: 'app',
    candidates: ['code', commonProgramPath('Microsoft VS Code', 'Code.exe')],
  },
  {
    id: 'visualstudio',
    label: 'Visual Studio',
    kind: 'app',
    candidates: ['devenv'],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    kind: 'app',
    candidates: ['cursor', localAppDataPath('Programs', 'Cursor', 'Cursor.exe')],
  },
  {
    id: 'antigravity',
    label: 'Antigravity',
    kind: 'app',
    candidates: ['antigravity'],
  },
  {
    id: 'git-bash',
    label: 'Git Bash',
    kind: 'git-bash',
    candidates: ['git-bash.exe', commonProgramPath('Git', 'git-bash.exe')],
  },
  {
    id: 'wsl',
    label: 'WSL',
    kind: 'wsl',
    candidates: ['wsl.exe'],
  },
  {
    id: 'idea',
    label: 'IntelliJ IDEA',
    kind: 'app',
    candidates: ['idea64.exe', 'idea'],
  },
  {
    id: 'rider',
    label: 'Rider',
    kind: 'app',
    candidates: ['rider64.exe', 'rider'],
  },
  {
    id: 'pycharm',
    label: 'PyCharm',
    kind: 'app',
    candidates: ['pycharm64.exe', 'pycharm'],
  },
  {
    id: 'webstorm',
    label: 'WebStorm',
    kind: 'app',
    candidates: ['webstorm64.exe', 'webstorm'],
  },
];

const toolbarTargetOrder = [
  'vscode',
  'visualstudio',
  'cursor',
  'antigravity',
  'explorer',
  'terminal',
  'git-bash',
  'wsl',
  'idea',
  'rider',
  'pycharm',
  'webstorm',
];

export function discoverOpenTargets(
  openWith: OpenWithSettings,
  resolveCommand: CommandResolver,
): OpenAppTarget[] {
  const detectedTargets = builtinOpenTargets.flatMap((target) => {
    const command = resolveFirstCommand(target.candidates, resolveCommand);
    return command
      ? [
          {
            id: target.id,
            label: target.label,
            kind: target.kind,
            command,
            args: target.args ?? [],
          } satisfies OpenAppTarget,
        ]
      : [];
  });

  const terminalCommand = resolveCommand('wt.exe') || resolveCommand('cmd.exe') || 'cmd.exe';
  const fixedTargets: OpenAppTarget[] = [
    {
      id: 'explorer',
      label: 'File Explorer',
      kind: 'explorer',
      command: 'explorer.exe',
      args: [],
    },
    {
      id: 'terminal',
      label: 'Terminal',
      kind: 'terminal',
      command: terminalCommand,
      args: [],
    },
  ];

  const customTargets = openWith.customTargets.flatMap((target) => {
    if (!target.command) {
      return [];
    }
    const command = resolveCommand(target.command) || target.command;
    return [
      {
        ...target,
        command,
      },
    ];
  });

  return dedupeTargets([...orderTargets([...detectedTargets, ...fixedTargets]), ...customTargets]);
}

export function findOpenTarget(
  targets: OpenAppTarget[],
  selectedTargetId: string,
): OpenAppTarget | undefined {
  return targets.find((target) => target.id === selectedTargetId) ?? targets[0];
}

export function buildOpenTargetLaunch(target: OpenAppTarget, projectPath: string): OpenTargetLaunch {
  const command = target.command ?? '';
  switch (target.kind) {
    case 'explorer':
      return {
        command: command || 'explorer.exe',
        args: [projectPath],
      };
    case 'terminal':
      if (path.basename(command).toLowerCase() === 'wt.exe') {
        return {
          command,
          args: ['-d', projectPath],
        };
      }
      return {
        command: command || 'cmd.exe',
        args: ['/K', 'cd', '/d', projectPath],
      };
    case 'git-bash':
      return {
        command,
        args: [`--cd=${projectPath}`],
      };
    case 'wsl':
      return {
        command,
        args: ['--cd', toWslPath(projectPath)],
      };
    case 'app':
    case 'command':
    default:
      return {
        command,
        args: [...target.args, projectPath],
      };
  }
}

export function parseOpenWithArgs(value: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if ((character === '"' || character === "'") && !quote) {
      quote = character;
      continue;
    }

    if (quote && character === quote) {
      quote = null;
      continue;
    }

    if (!quote && /\s/.test(character)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += character;
  }

  if (current) {
    args.push(current);
  }

  return args;
}

export function toWslPath(projectPath: string) {
  const match = projectPath.match(/^([a-zA-Z]):[\\/](.*)$/);
  if (!match) {
    return projectPath.replace(/\\/g, '/');
  }

  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, '/')}`;
}

function resolveFirstCommand(candidates: string[], resolveCommand: CommandResolver) {
  for (const candidate of candidates) {
    const resolved = resolveCommand(candidate);
    if (resolved) {
      return resolved;
    }
  }

  return '';
}

function dedupeTargets(targets: OpenAppTarget[]) {
  const seen = new Set<string>();
  return targets.filter((target) => {
    if (seen.has(target.id)) {
      return false;
    }
    seen.add(target.id);
    return true;
  });
}

function orderTargets(targets: OpenAppTarget[]) {
  const order = new Map(toolbarTargetOrder.map((id, index) => [id, index]));
  return [...targets].sort((left, right) => {
    const leftIndex = order.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = order.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
}

function commonProgramPath(...segments: string[]) {
  return path.join(process.env.ProgramFiles || 'C:\\Program Files', ...segments);
}

function localAppDataPath(...segments: string[]) {
  return path.join(process.env.LOCALAPPDATA || '', ...segments);
}
