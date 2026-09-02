module.exports = {
  apps: [{
    name: 'bitrix-tg',
    script: 'webhook.js',
    env_file: '.env',
    restart_delay: 5000,
    max_restarts: 10,
  }],
};
