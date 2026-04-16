module.exports = {
  apps: [
    {
      name: 'memento-api',
      script: 'build/src/index.js',
      node_args: '--dns-result-order=ipv4first',
      instances: 2,
      exec_mode: 'cluster',
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
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
      // Watch disabled in production
      watch: false,
    },
    {
      name: 'memento-worker',
      script: 'build/src/workers/index.js',
      node_args: '--dns-result-order=ipv4first',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '800M',
      env: {
        NODE_ENV: 'production',
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
