import path from 'node:path';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

export const DEV_SESSION_FILE = '.codem-dev-session.json';

export function getDevSessionPath(cwd = process.cwd()) {
  return path.join(cwd, DEV_SESSION_FILE);
}

export async function readDevSessionState(cwd = process.cwd()) {
  try {
    const content = await readFile(getDevSessionPath(cwd), 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function writeDevSessionState(cwd = process.cwd(), state) {
  const filePath = getDevSessionPath(cwd);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), 'utf8');
}

export async function clearDevSessionState(cwd = process.cwd()) {
  await rm(getDevSessionPath(cwd), { force: true });
}
