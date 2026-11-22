import os from 'node:os';
import { z } from 'zod';
import { registerTool } from './registry.js';

const noArgs = z.object({}).strict();

export function registerSystemTools(): void {
  registerTool({
    name: 'get_system_info',
    description: 'Returns basic information about the machine running the NEXUS API: OS, uptime, CPU count, memory, Node version.',
    risk: 'safe',
    localDevice: true,
    argsSchema: noArgs,
    handler: () => ({
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      hostname: os.hostname(),
      uptimeSeconds: Math.round(os.uptime()),
      cpuCount: os.cpus().length,
      totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
      freeMemoryMb: Math.round(os.freemem() / 1024 / 1024),
      nodeVersion: process.version,
    }),
  });

  registerTool({
    name: 'get_datetime',
    description: 'Returns the current date, time, timezone, and Unix timestamp of the NEXUS API server.',
    risk: 'safe',
    argsSchema: noArgs,
    handler: () => {
      const now = new Date();
      return {
        iso: now.toISOString(),
        local: now.toString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        unix: Math.floor(now.getTime() / 1000),
      };
    },
  });
}
