import React, { useState, useEffect } from 'react';
import { createTerminalApp } from '@ilovereact/terminal';
import { getSystemInfo } from './sysinfo';
import App from './App';

function TerminalNeofetch() {
  const [info, setInfo] = useState(getSystemInfo());
  useEffect(() => {
    const t = setInterval(() => setInfo(getSystemInfo()), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <App
      info={info}
      heartPx={1}
      padding={1}
      cardPadding={0}
      gap={2}
      lineGap={0}
      fontSize={1}
      titleSize={1}
      labelWidth={9}
      showCard={false}
    />
  );
}

const app = createTerminalApp({ fps: 30, fullscreen: true });
app.render(<TerminalNeofetch />);
