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
        windowsHide: true,
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
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = '选择要添加的项目目录'
$dialog.Filter = '文件夹|*.folder'
$dialog.CheckFileExists = $false
$dialog.CheckPathExists = $true
$dialog.ValidateNames = $false
$dialog.DereferenceLinks = $true
$dialog.Multiselect = $false
$dialog.FileName = '选择当前文件夹'
if ('${escapedPath}') {
  $initialPath = '${escapedPath}'
  if ([System.IO.File]::Exists($initialPath)) {
    $initialPath = [System.IO.Path]::GetDirectoryName($initialPath)
  }
  if ([System.IO.Directory]::Exists($initialPath)) {
    $dialog.InitialDirectory = $initialPath
  }
}
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.StartPosition = 'Manual'
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.Location = New-Object System.Drawing.Point(-32000, -32000)
$owner.ShowInTaskbar = $false
$owner.Show()
$owner.Activate()
$result = $dialog.ShowDialog($owner)
$owner.Close()
if ($result -eq [System.Windows.Forms.DialogResult]::OK -and $dialog.FileName) {
  $selectedPath = $dialog.FileName
  if (-not [System.IO.Directory]::Exists($selectedPath)) {
    $selectedPath = [System.IO.Path]::GetDirectoryName($selectedPath)
  }
  if ($selectedPath) {
    Write-Output $selectedPath
  }
}
`.trim();
}
