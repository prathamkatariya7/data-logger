module.exports = {
  apps: [
    {
      name: 'data-logger',
      script: 'server.js',
      node_args: '--max-old-space-size=1536',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
