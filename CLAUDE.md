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
node scripts/computer-bench.ts  # kitchen computer: DOOM timedemo, guest MIPS (--engine jit|interpreter)
firmware/doom/build.sh       # rebuild the DOOM firmware (needs `brew install llvm lld`)
```

## Map

- `packages/shared` - protocol (zod schemas), constants, world colliders, deterministic movement simulation.
  Consumed as TypeScript source by both apps (no build step).
- `apps/server` - Node WebSocket room server (`ws`), and Chef Skinner, the lobby's resident knife-throwing cook (`chef.ts`).
  Runs TypeScript natively in dev (`node --watch src/index.ts`), bundled with esbuild for production.
- `apps/client` - Vite + Three.js client.
  `src/content.ts` holds all personal content (Daniel's resume; the few lines still wanting his words are marked `TODO(daniel)`).
  `index.html` is the 3D world, `portfolio.html` is the static fallback.
  `src/computer/` is the kitchen computer: a RISC-V machine (interpreter and JIT) in a Web Worker that runs DOOM; `src/game/computerDesk.ts` hooks it into the game.
- `firmware` - C sources for the computer: vendored `doomgeneric`, a freestanding libc, `crt0.S`, the linker script, and the ABI header `machine.h`.
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
5. For render-loop changes, run `node scripts/perf.ts` (expect 60 fps, about 2 ms frame CPU, about 76 draw calls with 16 players and bots throwing knives; about 30 of the calls are post-processing passes).

## Gotchas

- Shadow-casting `InstancedMesh`es need `assignShadowDepthMaterials` (done in `WorldScene`), or three.js re-derives shader parameters every frame.
- Static kitchen geometry goes through `Kit` (`apps/client/src/world/kit.ts`), which merges it into one mesh per material; do not add standalone meshes for static props.
- Fixture footprints, stations and doors live in `packages/shared/src/world.ts`; colliders, the minimap and the renderer all read them, so move things there, not in the client.
- E2E uses SwiftShader, which gets the low quality tier automatically; screenshots and perf use the real GPU and `?quality=high`.
- A protocol or shared-simulation change bumps `PROTOCOL_VERSION`; Vercel deploys the client on every push to `main`, but the AWS room server only with `npm run deploy:aws`, so until then visitors play solo.
- The look (evening service, after Ratatouille) is split by quality tier: `world/lighting.ts` has the lights for both, and the high tier adds shadows, the practical lights and `world/post.ts` (N8AO, bloom, AgX, the grade).
  Lamps and glowing things are the `light` layer, which shines past white on the high tier so bloom catches it; keep new glowing paint dim, or it blows out.
  Keep `scene.environmentIntensity` tiny and raise `envMapIntensity` on metals instead; a brighter environment lights everything from every side and flattens the room.
- A GPU-bound frame is input lag, not just a lower frame rate (the browser queues frames). `world/governor.ts` steps the high tier's resolution, MSAA and AO down to keep up with the display; the level it settles on is stored in `localStorage` (`world.renderLevel`), so clear it when judging a visual change.
  Perf and screenshots run at device pixel ratio 1; check retina (ratio 2) too, where the high tier costs four times the pixels.
- The view outside the windows is real geometry in `world/outside.ts` (`OutsideView`, one unlit mesh), its light and haze baked into vertex colors.
  `outside.test.ts` raycasts every pane and skylight; keep it passing when moving the land, the sky or the windows, or a visitor will see an edge.
- The light follows the visitor's local time (`world/timeOfDay.ts`): looks at hours of the day, blended between, repainted every quarter hour.
  `?time=20:00` pins the hour; screenshots use it, and so should anyone judging a lighting change (the evening look is the reference).
- The hand on screen is solved, not keyed: `world/hand.ts` wraps it round each knife's handle (`knifeHand` in `world/viewmodel.ts`), so a new knife needs no hand work; `viewmodelHand.test.ts` checks every knife's grip, ring and wrist in the scene as drawn.
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

- The kitchen computer's firmware (`apps/client/src/computer/assets/doom.elf`) is committed prebuilt, because the site's builds have no RISC-V toolchain; after changing anything in `firmware/`, rebuild it with `firmware/doom/build.sh` and commit the ELF.
  `firmware/include/machine.h` and `src/computer/abi.ts` must agree (`abi.test.ts` checks).
  At the computer every key goes to DOOM except Esc, which steps away (under pointer lock the browser takes Esc anyway); DOOM's menu is on the backquote key, and the mouse takes `movementX` in CSS pixels (`KitchenComputer.mouseMove` scales it to DOOM's counts).
