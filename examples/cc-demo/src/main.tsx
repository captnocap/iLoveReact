/**
 * CC Demo entry point.
 *
 * Starts a WebSocket server and renders the demo app.
 * Connect from ComputerCraft with startup.lua or any WS client to see output.
 */

import React from 'react';
import { createCCServer } from '@ilovereact/cc';
import App from './App';

const server = createCCServer({
  port: 8080,
  width: 51,
  height: 19,
});

console.log('CC Demo server running on ws://localhost:8080');
console.log('Terminal size: 51x19');
console.log('Connect with ComputerCraft or wscat to see draw commands.');

server.render(<App />);

// Keep process alive
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.stop();
  process.exit(0);
});
