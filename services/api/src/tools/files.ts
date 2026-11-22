import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { registerTool } from './registry.js';

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', 'appdata', '$recycle.bin', 'system volume information',
  '.cache', '.npm', '.vscode', 'windows', 'program files', 'program files (x86)', 'programdata',
]);

const SEARCH_ROOTS = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos'];

export interface FoundFile {
  path: string;
  name: string;
  folder: string;
  modified: string;
  sizeKb: number;
}

export function searchUserFiles(query: string, folder?: string): FoundFile[] {
  const needle = query.toLowerCase();
  const roots = folder
    ? [path.resolve(folder)]
    : SEARCH_ROOTS.map((name) => path.join(os.homedir(), name)).filter((p) => fs.existsSync(p));

  const results: FoundFile[] = [];
  const deadline = Date.now() + 12_000;
  for (const root of roots) {
    if (fs.existsSync(root)) walk(root, needle, 0, deadline, results);
    if (results.length >= 25 || Date.now() > deadline) break;
  }
  return results;
}

function walk(dir: string, query: string, depth: number, deadline: number, out: FoundFile[]): void {
  if (depth > 6 || out.length >= 25 || Date.now() > deadline) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= 25 || Date.now() > deadline) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name.toLowerCase())) walk(full, query, depth + 1, deadline, out);
      continue;
    }
    if (!entry.name.toLowerCase().includes(query)) continue;
    try {
      const stat = fs.statSync(full);
      out.push({
        path: full,
        name: entry.name,
        folder: path.dirname(full),
        modified: stat.mtime.toISOString(),
        sizeKb: Math.round(stat.size / 1024),
      });
    } catch {
      // Skip unreadable files.
    }
  }
}

export function registerFileTools(): void {
  registerTool({
    name: 'find_files',
    description:
      'Searches the user\'s computer for files and folders whose names contain the query (e.g. "awtalgn", "report", "invoice"). Returns matching paths. Read-only and safe.',
    risk: 'safe',
    localDevice: true,
    argsSchema: z
      .object({
        query: z.string().min(1).max(200),
        folder: z.string().max(500).optional(),
      })
      .strict(),
    handler: (args) => {
      const files = searchUserFiles(String(args.query), args.folder ? String(args.folder) : undefined);
      return { query: String(args.query), count: files.length, files };
    },
  });

  registerTool({
    name: 'read_file',
    description: 'Reads a text file from the user\'s computer and returns its contents (up to ~100k characters). Use after find_files to read a located file. Read-only and safe.',
    risk: 'safe',
    localDevice: true,
    argsSchema: z.object({ path: z.string().min(1).max(500) }).strict(),
    handler: (args) => {
      const resolved = path.resolve(expandUserPath(String(args.path)));
      if (!fs.existsSync(resolved)) throw new Error(`File does not exist: ${resolved}`);
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) throw new Error(`Not a file: ${resolved}`);
      if (stat.size > 2 * 1024 * 1024) throw new Error('File is larger than 2 MB — cannot read it safely.');
      const content = fs.readFileSync(resolved, 'utf8').slice(0, 100_000);
      return { path: resolved, name: path.basename(resolved), sizeBytes: stat.size, content };
    },
  });
}

function expandUserPath(input: string): string {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) return path.join(os.homedir(), input.slice(2));
  return input;
}
