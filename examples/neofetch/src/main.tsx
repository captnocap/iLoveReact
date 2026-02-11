import React from 'react';
import { createLove2DApp, useLoveState } from '@ilovereact/native';
import App from './App';
import type { SystemInfo } from './sysinfo';

function LoveNeofetch() {
  const [user]     = useLoveState('sys.user', '...');
  const [hostname] = useLoveState('sys.hostname', '...');
  const [osName]   = useLoveState('sys.os', '...');
  const [kernel]   = useLoveState('sys.kernel', '...');
  const [uptime]   = useLoveState('sys.uptime', '...');
  const [shell]    = useLoveState('sys.shell', '...');
  const [cpu]      = useLoveState('sys.cpu', '...');
  const [memory]   = useLoveState('sys.memory', '...');
  const [arch]     = useLoveState('sys.arch', '...');
  const [fps]      = useLoveState('sys.fps', 0);

  const info: SystemInfo = {
    user, hostname, os: osName, kernel, uptime,
    shell, cpu, memory, arch, node: '',
  };

  return <App info={info} showFps={fps} />;
}

const app = createLove2DApp();
app.render(<LoveNeofetch />);
