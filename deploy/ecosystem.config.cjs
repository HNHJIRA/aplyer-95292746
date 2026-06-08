module.exports = {
  apps: [
    {
      name: "aplyer",
      script: ".output/server/index.mjs",
      cwd: "/var/www/aplyer",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
        // These will be overridden by systemd env vars or a .env file on the server
      },
      env_file: "/var/www/aplyer/.env",
      log_file: "/var/log/aplyer/combined.log",
      out_file: "/var/log/aplyer/out.log",
      error_file: "/var/log/aplyer/error.log",
      time: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      listen_timeout: 10000,
      kill_timeout: 5000,
    },
  ],
};
