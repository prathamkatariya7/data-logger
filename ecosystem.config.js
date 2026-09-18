/**
 * @module ecosystem.config
 * @description PM2 Ecosystem configuration file for production process management on AWS EC2.
 * Allocates 1.5GB V8 memory heap limit and enables manual garbage collection exposed flags (--expose-gc).
 */

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
