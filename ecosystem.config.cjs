module.exports = {
  apps: [{
    name: 'qq-mail-relay',
    script: 'server/index.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '400M',
    kill_timeout: 12000,
    env: { NODE_ENV: 'production' },
  }],
};
