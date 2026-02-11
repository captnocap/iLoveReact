/**
 * System info gathering — reads from Node.js os module + /etc/os-release.
 * Refreshable at runtime for live uptime/memory updates.
 */

import os from 'os';
import { execSync } from 'child_process';

export interface SystemInfo {
  user: string;
  hostname: string;
  os: string;
  kernel: string;
  uptime: string;
  shell: string;
  cpu: string;
  memory: string;
  arch: string;
  node: string;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  if (mins > 0) parts.push(`${mins} min${mins !== 1 ? 's' : ''}`);
  return parts.join(', ') || '< 1 min';
}

function formatBytes(bytes: number): string {
  const gib = bytes / (1024 * 1024 * 1024);
  if (gib >= 1) return `${gib.toFixed(1)} GiB`;
  const mib = bytes / (1024 * 1024);
  return `${mib.toFixed(0)} MiB`;
}

function getDistro(): string {
  try {
    const release = execSync('cat /etc/os-release', { encoding: 'utf-8' });
    const match = release.match(/PRETTY_NAME="(.+?)"/);
    if (match) return match[1];
  } catch {}
  return `${os.type()} ${os.release()}`;
}

export function getSystemInfo(): SystemInfo {
  const cpus = os.cpus();
  const cpuModel = (cpus[0]?.model || 'unknown')
    .replace(/\(R\)/g, '')
    .replace(/\(TM\)/g, '')
    .replace(/CPU\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    user: os.userInfo().username,
    hostname: os.hostname(),
    os: getDistro(),
    kernel: os.release(),
    uptime: formatUptime(os.uptime()),
    shell: (process.env.SHELL || 'unknown').split('/').pop() || 'unknown',
    cpu: `${cpuModel} (${cpus.length} cores)`,
    memory: `${formatBytes(os.totalmem() - os.freemem())} / ${formatBytes(os.totalmem())}`,
    arch: os.arch(),
    node: process.version,
  };
}
