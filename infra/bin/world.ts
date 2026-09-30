import { resolve } from 'node:path';
import { App } from 'aws-cdk-lib';
import { WorldStack } from '../lib/world-stack.ts';

const app = new App();
const build = resolve(import.meta.dirname, '../build');

new WorldStack(app, 'DanielWorld', {
  description: "Daniel's World: static site on S3 + CloudFront, WebSocket room server on EC2",
  // Concrete account and region are needed to look up the CloudFront origin-facing prefix list.
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  clientDir: resolve(build, 'client'),
  serverDir: resolve(build, 'server'),
});
