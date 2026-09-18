module.exports = {
  apps: [
    {
      name: 'data-logger',
      script: 'server.js',
      node_args: '--max-old-space-size=1536 --expose-gc',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
