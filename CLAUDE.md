# Daniel's World - project guide

A first-person 3D multiplayer personal website.
Visitors walk a classical French brigade kitchen as cooks, click its stations to learn about Daniel, and see each other in real time.
`SPEC.md` is the source of truth for scope, `DECISIONS.md` records judgment calls, `PROGRESS.md` tracks milestones.

## Commands

```bash
npm install                  # install all workspaces
npm run dev                  # server on :3001 + client on :5173
npm run lint                 # eslint + prettier --check
npm run format               # prettier --write
npm run typecheck            # tsc in every workspace + root (e2e, scripts, configs)
npm test                     # vitest (all workspaces)
npx playwright install chromium
npm run e2e                  # playwright, builds client in test mode, spawns its own server on :3101
npm run build                # server bundle (apps/server/dist) + client (apps/client/dist)
npm run bots -- --count 15   # simulated players for load testing
npm run deploy:aws           # build assets + cdk deploy (needs AWS credentials)
node scripts/screenshots.ts  # regenerate docs/screenshots (starts what it needs, real GPU)
node scripts/perf.ts         # 16-player perf report (needs the dev client on :5173)
```

## Map

- `packages/shared` - protocol (zod schemas), constants, world colliders, deterministic movement simulation.
  Consumed as TypeScript source by both apps (no build step).
- `apps/server` - Node WebSocket room server (`ws`).
  Runs TypeScript natively in dev (`node --watch src/index.ts`), bundled with esbuild for production.
- `apps/client` - Vite + Three.js client.
  `src/content.ts` holds all personal content (placeholders marked `TODO(daniel)`).
  `index.html` is the 3D world, `portfolio.html` is the static fallback.
- `infra` - AWS CDK stack (CloudFront + S3 site, EC2 room server, CloudWatch, IAM). `npm run deploy:aws` deploys.
- `e2e` - Playwright specs; they assert on `window.__world` debug state, not pixels.
- `scripts` - dev tooling (bots, screenshots).

## Conventions

- TypeScript strict everywhere, ESM, relative imports use explicit `.ts` extensions.
  Only erasable TS syntax (no enums, no parameter properties) so Node can strip types.
- Anything both client and server must agree on (tick rate, speeds, bounds, colliders, simulation) lives in `packages/shared`.
- Every inbound network message is parsed with the shared zod schemas; invalid messages are dropped.
- Render loop hot paths must not allocate: reuse vectors, matrices and arrays.
- Share geometries and materials; prefer `InstancedMesh` for repeated objects.
- UI overlays are plain DOM + CSS, keyboard accessible, and use `textContent` for any user-provided text.
- `window.__world` debug state exists only when `import.meta.env.MODE !== 'production'`.

## How to verify a change

1. `npm run lint && npm run typecheck && npm test`
2. `npm run e2e` for anything touching networking, controls, or UI flow.
3. `npm run build` before committing.
4. For visual changes, run `node scripts/screenshots.ts` and look at `docs/screenshots/`.
5. For render-loop changes, run `node scripts/perf.ts` (expect 60 fps, about 1 ms frame CPU, about 40 draw calls with 16 players and bots throwing knives).

## Gotchas

- Shadow-casting `InstancedMesh`es need `assignShadowDepthMaterials` (done in `WorldScene`), or three.js re-derives shader parameters every frame.
- Static kitchen geometry goes through `Kit` (`apps/client/src/world/kit.ts`), which merges it into one mesh per material; do not add standalone meshes for static props.
- Fixture footprints, stations and doors live in `packages/shared/src/world.ts`; colliders, the minimap and the renderer all read them, so move things there, not in the client.
- E2E uses SwiftShader, which gets the low quality tier automatically; screenshots and perf use the real GPU and `?quality=high`.
- A protocol or shared-simulation change bumps `PROTOCOL_VERSION`; Vercel deploys the client on every push to `main`, but the AWS room server only with `npm run deploy:aws`, so until then visitors play solo.
- The first player in a room spawns at `SPAWN`, by the dining room doors with the pass just ahead; E2E walking paths rely on that, strafing along the aisle or rounding the west end of the pass.

<!-- BEGIN AWS Agent Toolkit rules -->

# AWS Guidance

- Where these AWS rules conflict with the project's own instructions, the
  project's instructions take precedence.
- Prefer the AWS MCP Server for AWS interactions - it provides sandboxed
  execution, observability, and audit logging. If unavailable, use the
  AWS CLI directly.
- Before starting a task, check whether a relevant AWS skill is available.
  Load the skill with `retrieve_skill` and prefer its guidance over
  general knowledge.
- When uncertain about specific AWS details (API parameters, permissions,
  limits, error codes), verify against documentation rather than guessing.
  State uncertainty explicitly if you cannot confirm.
- When creating infrastructure, prefer infrastructure-as-code (AWS CDK or
  CloudFormation) over direct CLI commands.
- When working with infrastructure, follow AWS Well-Architected Framework
  principles.
- Do not use em dashes in AWS resource names or descriptions. Use
  hyphens instead.

## Secret Safety

- MUST load the `aws-secrets-manager` skill first for any secret,
  credential, API key, token, or password task. MUST NOT call
  `secretsmanager get-secret-value` or `batch-get-secret-value`, and MUST
  NOT hit the Secrets Manager Agent daemon directly. MUST use
  `{{resolve:secretsmanager:secret-id:SecretString:json-key}}` with
  `asm-exec` so the secret resolves at runtime without entering context.

<!-- END AWS Agent Toolkit rules -->
