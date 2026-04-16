// ──────────────────────────────────────────────────────────────
// PM2 ecosystem config
//
// Supports both dev and prod on the same server via MEMENTO_ENV.
// The deploy workflow sets MEMENTO_ENV before running pm2 start.
//
// Usage:
//   MEMENTO_ENV=prod pm2 start ecosystem.config.js
//   MEMENTO_ENV=dev  pm2 start ecosystem.config.js
// ──────────────────────────────────────────────────────────────

const ENV = process.env.MEMENTO_ENV || 'prod';

const config = {
  prod: {suffix: 'prod', port: 4001, apiInstances: 3},
  dev: {suffix: 'dev', port: 3001, apiInstances: 1},
};

const {suffix, port, apiInstances} = config[ENV] || config.prod;

module.exports = {
  apps: [
    {
      name: `memento-backend-${suffix}`,
      script: 'build/src/index.js',
      node_args: '--dns-result-order=ipv4first',
      instances: apiInstances,
      exec_mode: 'cluster',
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: port,
      },
      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 10000,
      // Logs
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // Auto-restart on failure
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,
      watch: false,
    },
    {
      name: `memento-backend-${suffix}-worker`,
      script: 'build/src/workers/index.js',
      node_args: '--dns-result-order=ipv4first',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '800M',
      env: {
        NODE_ENV: 'production',
        PORT: port,
      },
      // Workers may run long jobs — give them time to finish
      kill_timeout: 30000,
      // Logs
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // Auto-restart on failure
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,
      watch: false,
    },
  ],
};
