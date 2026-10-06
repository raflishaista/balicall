const path = require('node:path');
const fs = require('node:fs');

// Resolve livekit binary path
const localLiveKit = path.join(__dirname, 'bin', 'livekit-server');
const livekitCmd = fs.existsSync(localLiveKit) ? localLiveKit : 'livekit-server';

module.exports = {
  apps: [
    {
      name: 'balicall-sfu',
      script: livekitCmd,
      args: fs.existsSync(path.join(__dirname, 'livekit.yaml'))
        ? '--config livekit.yaml --dev'
        : '--dev',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      watch: false,
    },
    {
      name: 'balicall-server',
      script: './server/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      watch: false,
    },
  ],
};
