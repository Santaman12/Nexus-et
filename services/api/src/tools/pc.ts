import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { registerTool } from './registry.js';
import { searchUserFiles } from './files.js';

function runCapture(command: string, args: string[], timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `Command exited with code ${code}`));
    });
  });
}

function openPath(target: string): Promise<{ opened: string }> {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    let isDir = false;
    try {
      isDir = fs.statSync(target).isDirectory();
    } catch {
      // URLs and not-yet-existing paths are not directories.
    }
    let command: string;
    let args: string[];
    if (isWin && !isDir) {
      // Files and URLs: hand to the Windows default handler so videos open in
      // the media player, documents in their app, links in the browser.
      command = 'rundll32.exe';
      args = ['url.dll,FileProtocolHandler', target];
    } else {
      command = isWin ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      args = [target];
    }
    const child = spawn(command, args, { windowsHide: true, detached: true, stdio: 'ignore' });
    child.unref();
    child.on('error', reject);
    // Give the OS a moment to accept the request.
    setTimeout(() => resolve({ opened: target }), 800);
  });
}

function expandHome(input: string): string {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) return path.join(os.homedir(), input.slice(2));
  return input;
}

let batteryCache: { at: number; value: Record<string, unknown> } | null = null;
const BATTERY_CACHE_MS = 30_000;

async function queryBatteryWmic(): Promise<Record<string, unknown> | null> {
  const output = await runCapture('wmic.exe', [
    'path',
    'win32_battery',
    'get',
    'EstimatedChargeRemaining,BatteryStatus',
    '/format:list',
  ], 10_000);
  const fields: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq > 0) fields[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  const charge = Number(fields.EstimatedChargeRemaining);
  const status = Number(fields.BatteryStatus);
  if (!Number.isFinite(charge)) return null;
  return {
    supported: true,
    chargePercent: charge,
    charging: status === 2,
    onAcPower: status === 2,
  };
}

async function queryBatteryPowerShell(): Promise<Record<string, unknown> | null> {
  const output = await runCapture('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Get-CimInstance -ClassName Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress',
  ], 45_000);
  const parsed = JSON.parse(output || 'null') as
    | { EstimatedChargeRemaining?: number; BatteryStatus?: number }
    | Array<{ EstimatedChargeRemaining?: number; BatteryStatus?: number }>
    | null;
  const battery = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!battery) return null;
  return {
    supported: true,
    chargePercent: battery.EstimatedChargeRemaining ?? null,
    charging: battery.BatteryStatus === 2,
    onAcPower: battery.BatteryStatus === 2,
  };
}

function wmicValue(className: string, props: string, where = ''): Promise<Record<string, string>> {
  const args = ['path', className];
  if (where) args.push('where', where);
  args.push('get', props, '/format:list');
  return runCapture('wmic.exe', args, 10_000).then((output) => {
    const fields: Record<string, string> = {};
    for (const line of output.split(/\r?\n/)) {
      const eq = line.indexOf('=');
      if (eq > 0) fields[line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1).trim();
    }
    return fields;
  });
}

const MEDIA_KEYS: Record<string, string> = {
  mute: '{VOLUME_MUTE}',
  volume_up: '{VOLUME_UP}',
  volume_down: '{VOLUME_DOWN}',
  next: '{MEDIA_NEXT_TRACK}',
  previous: '{MEDIA_PREV_TRACK}',
  play_pause: '{MEDIA_PLAY_PAUSE}',
};

function findStartMenuShortcut(name: string): string | null {
  const needle = name.toLowerCase();
  const roots = [
    path.join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs',
  ];
  const deadline = Date.now() + 4000;
  const stack = roots.filter(Boolean);
  while (stack.length && Date.now() < deadline) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (stack.length < 4000) stack.push(full);
      } else if (entry.name.toLowerCase().endsWith('.lnk') && entry.name.toLowerCase().includes(needle)) {
        return full;
      }
    }
  }
  return null;
}

const APP_ALIASES: Record<string, string> = {
  calculator: 'calc',
  calc: 'calc',
  notepad: 'notepad',
  paint: 'mspaint',
  wordpad: 'write',
  explorer: 'explorer',
  files: 'explorer',
  cmd: 'cmd',
  command: 'cmd',
  prompt: 'cmd',
  powershell: 'powershell',
  terminal: 'wt',
  spotify: 'spotify',
  chrome: 'chrome',
  googlechrome: 'chrome',
  firefox: 'firefox',
  edge: 'msedge',
  vscode: 'code',
  code: 'code',
};

async function resolveApp(name: string): Promise<string> {
  const candidates = [APP_ALIASES[name.toLowerCase()], name].filter((v): v is string => Boolean(v));
  for (const candidate of candidates) {
    const resolved = await resolveAppCandidate(candidate);
    if (resolved) return resolved;
  }
  throw new Error(`Could not find an application named "${name}". Try the exact app name or its .exe file.`);
}

async function resolveAppCandidate(name: string): Promise<string | null> {
  const exeName = /\.exe$/i.test(name) ? name : `${name}.exe`;
  try {
    const where = await runCapture('where.exe', [exeName], 5000);
    const first = where.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    if (first) return first;
  } catch {
    // Not on PATH — try App Paths registry and Start Menu.
  }
  for (const hive of ['HKLM', 'HKCU']) {
    const key = `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`;
    try {
      const out = await runCapture('reg.exe', ['query', key, '/ve'], 5000);
      const match = /REG_SZ\s+(.+)$/m.exec(out);
      if (match?.[1]?.trim() && fs.existsSync(match[1].trim())) return match[1].trim();
    } catch {
      // Key not present.
    }
  }
  const shortcut = findStartMenuShortcut(name);
  if (shortcut) return shortcut;
  return null;
}

export function registerPcTools(): void {
  registerTool({
    name: 'get_battery_status',
    description: 'Returns the battery charge percentage, charging state, and power source of the machine running NEXUS.',
    risk: 'safe',
    localDevice: true,
    argsSchema: z.object({}).strict(),
    handler: async () => {
      if (process.platform !== 'win32') {
        return { supported: false, platform: process.platform, message: 'Battery status is only implemented for Windows.' };
      }
      if (batteryCache && Date.now() - batteryCache.at < BATTERY_CACHE_MS) {
        return batteryCache.value;
      }
      let value: Record<string, unknown> | null = null;
      try {
        value = await queryBatteryWmic();
      } catch {
        value = null;
      }
      if (!value) {
        value = await queryBatteryPowerShell().catch(() => null);
      }
      if (!value) {
        return { supported: false, platform: process.platform, message: 'No battery detected (desktop or no battery present).' };
      }
      batteryCache = { at: Date.now(), value };
      return value;
    },
  });

  registerTool({
    name: 'open_file',
    description:
      'Opens a file or folder on the user\'s computer with its default application (videos play in the media player, documents in their app). Accepts an exact path OR a file name to search for. Requires confirmation for sensitive cases.',
    risk: 'sensitive',
    localDevice: true,
    argsSchema: z
      .object({
        path: z.string().min(1).max(500).optional(),
        file: z.string().min(1).max(500).optional(),
        name: z.string().min(1).max(300).optional(),
        query: z.string().min(1).max(300).optional(),
      })
      .catchall(z.unknown()),
    handler: async (args) => {
      const preferred = [args.path, args.file, args.name, args.query]
        .find((v) => typeof v === 'string' && String(v).trim());
      const fallback = Object.values(args).find((v) => typeof v === 'string' && String(v).trim());
      const raw = String(preferred ?? fallback ?? '').trim();
      if (!raw) throw new Error('Missing file target — provide a path or file name.');

      let resolved = path.resolve(expandHome(raw));
      let matchCount = 0;
      if (!fs.existsSync(resolved)) {
        const matches = searchUserFiles(path.basename(raw));
        if (matches.length === 0) {
          throw new Error(`Nothing found for "${raw}" — the path does not exist and no matching file was found.`);
        }
        resolved = matches[0]!.path;
        matchCount = matches.length;
      }
      const stat = fs.statSync(resolved);
      await openPath(resolved);
      return { opened: resolved, kind: stat.isDirectory() ? 'folder' : 'file', matchedFiles: matchCount || undefined };
    },
  });

  registerTool({
    name: 'open_music',
    description: 'Opens the user\'s Music folder (or a specific music file path if provided) on their computer.',
    risk: 'sensitive',
    localDevice: true,
    argsSchema: z.object({ path: z.string().max(500).optional() }).strict(),
    handler: async (args) => {
      const target = args.path
        ? path.resolve(expandHome(String(args.path)))
        : path.join(os.homedir(), 'Music');
      if (!fs.existsSync(target)) {
        throw new Error(`Music path does not exist: ${target}`);
      }
      await openPath(target);
      return { opened: target };
    },
  });

  registerTool({
    name: 'get_system_status',
    description: 'Returns a fast live snapshot of the machine: CPU load %, memory used/total, C: drive free/total space, and battery if present.',
    risk: 'safe',
    localDevice: true,
    argsSchema: z.object({}).strict(),
    handler: async () => {
      if (process.platform !== 'win32') {
        return { supported: false, platform: process.platform, message: 'Live system status is only implemented for Windows.' };
      }
      const [cpu, mem, disk] = await Promise.all([
        wmicValue('win32_processor', 'LoadPercentage').catch((): Record<string, string> => ({})),
        wmicValue('win32_operatingsystem', 'FreePhysicalMemory,TotalVisibleMemorySize').catch((): Record<string, string> => ({})),
        wmicValue('win32_logicaldisk', 'Size,FreeSpace', "DeviceID='C:'").catch((): Record<string, string> => ({})),
      ]);
      const battery = await queryBatteryWmic().catch(() => null);
      const totalMemKb = Number(mem.totalvisiblememorysize);
      const freeMemKb = Number(mem.freephysicalmemory);
      const totalDisk = Number(disk.size);
      const freeDisk = Number(disk.freespace);
      return {
        platform: process.platform,
        cpuLoadPercent: cpu.loadpercentage !== undefined ? Number(cpu.loadpercentage) : null,
        memory: Number.isFinite(totalMemKb)
          ? {
              totalMb: Math.round(totalMemKb / 1024),
              freeMb: Math.round(freeMemKb / 1024),
              usedPercent: Math.round((1 - freeMemKb / totalMemKb) * 100),
            }
          : null,
        diskC: Number.isFinite(totalDisk)
          ? {
              totalGb: Math.round((totalDisk / 1024 ** 3) * 10) / 10,
              freeGb: Math.round((freeDisk / 1024 ** 3) * 10) / 10,
              usedPercent: Math.round((1 - freeDisk / totalDisk) * 100),
            }
          : null,
        battery,
      };
    },
  });

  registerTool({
    name: 'open_app',
    description: 'Opens an installed application on the user\'s computer by name (e.g. "notepad", "calculator", "spotify"). Searches PATH, registry App Paths, and the Start Menu. Requires confirmation.',
    risk: 'sensitive',
    localDevice: true,
    argsSchema: z
      .object({
        name: z.string().min(1).max(200).optional(),
        app: z.string().min(1).max(200).optional(),
        app_name: z.string().min(1).max(200).optional(),
        application: z.string().min(1).max(200).optional(),
        program: z.string().min(1).max(200).optional(),
        target: z.string().min(1).max(200).optional(),
      })
      .catchall(z.unknown()),
    handler: async (args) => {
      const preferred = [args.name, args.app, args.app_name, args.application, args.program, args.target]
        .find((v) => typeof v === 'string' && String(v).trim());
      const fallback = Object.values(args).find((v) => typeof v === 'string' && String(v).trim());
      const raw = String(preferred ?? fallback ?? '').trim();
      if (!raw) throw new Error('Missing app name — provide the application to open.');
      const resolved = await resolveApp(raw);
      await openPath(resolved);
      return { opened: resolved, app: raw };
    },
  });

  registerTool({
    name: 'lock_workstation',
    description: 'Locks the Windows workstation immediately (same as Win+L). Requires confirmation.',
    risk: 'sensitive',
    localDevice: true,
    argsSchema: z.object({}).strict(),
    handler: async () => {
      if (process.platform !== 'win32') {
        throw new Error('Locking the workstation is only implemented for Windows.');
      }
      await runCapture('rundll32.exe', ['user32.dll,LockWorkStation'], 10_000);
      return { locked: true };
    },
  });

  registerTool({
    name: 'media_control',
    description: 'Controls media/system keys on the user\'s computer: mute, volume_up, volume_down, next, previous, play_pause. Requires confirmation.',
    risk: 'sensitive',
    localDevice: true,
    argsSchema: z.object({ action: z.enum(['mute', 'volume_up', 'volume_down', 'next', 'previous', 'play_pause']) }).strict(),
    handler: async (args) => {
      if (process.platform !== 'win32') {
        throw new Error('Media key control is only implemented for Windows.');
      }
      const key = MEDIA_KEYS[String(args.action)];
      await runCapture('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-STA',
        '-Command',
        `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${key}')`,
      ], 15_000);
      return { action: args.action, sent: key };
    },
  });

  registerTool({
    name: 'play_youtube',
    description: 'Opens YouTube (or YouTube Music for music requests) search results for the given query in the default browser so the user can play the video or song. Read-only, no confirmation needed.',
    risk: 'safe',
    localDevice: true,
    argsSchema: z.object({
      query: z.string().min(1).max(300),
      kind: z.enum(['video', 'music']).optional(),
    }).strict(),
    handler: async (args) => {
      const query = encodeURIComponent(String(args.query));
      const kind = args.kind === 'music' ? 'music' : 'video';
      const url = kind === 'music'
        ? `https://music.youtube.com/search?q=${query}`
        : `https://www.youtube.com/results?search_query=${query}`;
      await openPath(url);
      return { opened: url, kind };
    },
  });

  registerTool({
    name: 'open_url',
    description: 'Opens an http(s) URL in the default browser. Only http and https URLs are allowed.',
    risk: 'safe',
    localDevice: true,
    argsSchema: z.object({ url: z.string().url().max(2000) }).strict(),
    handler: async (args) => {
      const url = String(args.url);
      if (!/^https?:\/\//i.test(url)) {
        throw new Error('Only http:// and https:// URLs can be opened.');
      }
      await openPath(url);
      return { opened: url };
    },
  });
}
