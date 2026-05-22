module.exports = {
  apps: [
    // 服务端独立启动
    {
      name: 'server',
      cwd: './server',
      script: 'index.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'development',
        PORT: 3003
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3003
      },
      error_file: './logs/server-error.log',
      out_file: './logs/server-out.log',
      time: true
    },
    // 鸽子独立启动（单实例，通过 --doves 控制并发数）
    {
      name: 'dove',
      cwd: './doves',
      script: '入口.js',
      exec_mode: 'fork',
      args: '--doves=3',
      instances: 1,
      autorestart: true,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      },
      error_file: './logs/dove-error.log',
      out_file: './logs/dove-out.log',
      time: true
    }
  ]
};
