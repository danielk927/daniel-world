/**
 * Builds what the stack deploys into infra/build/:
 *   client/  the static site, configured to reach the room server on the same origin at /ws
 *   server/  the room server as one self-contained file (Node is the only runtime dependency)
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const build = resolve(root, 'infra/build');
const run = (args: string[], env: Record<string, string> = {}): void => {
  execFileSync('npm', args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
};

rmSync(build, { recursive: true, force: true });
mkdirSync(resolve(build, 'server'), { recursive: true });

run(
  [
    'run',
    'build',
    '-w',
    '@world/client',
    '--',
    '--outDir',
    resolve(build, 'client'),
    '--emptyOutDir',
  ],
  {
    VITE_SERVER_URL: '/ws',
  },
);
run(['run', 'build', '-w', '@world/server']);
copyFileSync(resolve(root, 'apps/server/dist/index.js'), resolve(build, 'server/index.js'));
console.log(`Assets ready in ${build}`);
