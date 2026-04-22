import path from 'node:path';
import { spawn } from 'node:child_process';

export async function selectDirectory(initialPath?: string) {
  const resolvedInitialPath = initialPath?.trim() ? path.resolve(initialPath.trim()) : '';
  const script = buildFolderPickerScript(resolvedInitialPath);

  return new Promise<string | null>((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        windowsHide: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `目录选择器执行失败，退出码 ${code}`));
        return;
      }

      const selectedPath = stdout.trim();
      resolve(selectedPath ? selectedPath : null);
    });
  });
}

function buildFolderPickerScript(initialPath: string) {
  const escapedPath = initialPath.replace(/'/g, "''");

  return `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择要添加的项目目录'
$dialog.ShowNewFolderButton = $false
if ('${escapedPath}') {
  $dialog.SelectedPath = '${escapedPath}'
}
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK -and $dialog.SelectedPath) {
  Write-Output $dialog.SelectedPath
}
`.trim();
}
