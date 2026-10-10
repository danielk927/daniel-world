# Daniel's World - project guide

A first-person 3D multiplayer personal website.
Visitors walk a classical French brigade kitchen as cooks, open its stations to learn about Daniel, and see each other in real time.
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
npm run e2e                  # playwright: builds the client in test mode into apps/client/dist-test-<client port>,
                             # serves it on :5174 and runs its own server on :3101; E2E_SERVER_PORT and
                             # E2E_CLIENT_PORT move both, so two suites can run at once, even in one checkout;
                             # E2E_CPU_THROTTLE=4 runs every page's CPU 4x slower, to see a spec holds when starved
npm run build                # server bundle (apps/server/dist) + client (apps/client/dist)
npm run bots                 # simulated players: fill the lobby but for one seat, yours
                             # (--count up to 15, --room <code>, --knives; Chef Skinner counts)
npm run deploy:aws           # build assets + cdk deploy (needs AWS credentials)
node scripts/screenshots.ts  # regenerate docs/screenshots (starts what it needs, real GPU;
                             # WORLD_CLIENT_PORT / WORLD_SERVER_PORT move it off :5173 / :3001)
node scripts/perf.ts         # 16-player perf report (starts what it needs, real GPU; --dpr 2 for retina;
                             # the same WORLD_* ports move it, and governorLevel above 0 means the GPU fell behind)
                             # (--uncapped lifts the frame rate cap to show real cost; --params adds to the URL)
node scripts/viewpoints.ts   # the kitchen from fixed viewpoints, real GPU, interface hidden (--out, --dpr,
                             # --only, --time, --params); before/after frames in docs/graphics-upgrade/
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
  `helpers.ts` has what they share; the room server they start runs in a process of its own (`roomServer.ts`).
- `scripts` - dev tooling (bots, screenshots, perf, viewpoints, computer-bench); `processes.ts` starts what they need and stops it with them.

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
4. For visual changes, run `node scripts/viewpoints.ts` (and `node scripts/screenshots.ts`) and look at the frames, at device pixel ratio 2 for detail.
5. For render-loop changes, run `node scripts/perf.ts` (expect 60 fps at governor level 0, about 1 ms frame CPU, about 86 draw calls and 710 k triangles with 16 players and bots throwing knives; about 30 of the calls are post-processing passes), and `--dpr 2` (60 fps, governor level 1 or 2).

## Gotchas

- Shadow-casting `InstancedMesh`es need `assignShadowDepthMaterials` (done in `WorldScene`), or three.js re-derives shader parameters every frame.
- Static kitchen geometry goes through `Kit` (`apps/client/src/world/kit.ts`), which merges it into one mesh per material; do not add standalone meshes for static props.
- The kitchen is not low-poly any more (`docs/graphics-upgrade.md`): round things get their sides from `kit.sides()` (a facet strays at most 0.6 mm from the circle), edges seen up close are `kit.rounded()`, and pots, plates and bottles are `kit.lathe()` profiles.
  Texture coordinates are meters, made by the builder: flat parts projected along their normal, round parts unrolled by the Kit's helpers (`uv: 'own'`).
  A layer is a material class; parts differ by vertex color (paint) and `finish` (a roughness multiplier).
  To add a material: a layer in `surfaces()` in `kit.ts` (and `LayerName`), a texture recipe in `world/surfaces/recipes.ts` (GLSL painting color, height in meters and roughness, tiling over one repeat) mapped in `LAYER_RECIPES` (`surfaces/dress.ts`); `shadeSurface` gives it the finish, the probe's box-projected reflections and tile variation.
  Textures are painted on the GPU at load, high tier only; the low tier keeps plain paint.
  A surface outside the Kit that should reflect the kitchen (the walk-in's door) takes `shadeSurface` and the probe as its `envMap` itself (`CoolerDoor.reflect`).
  Each new layer is a draw call (and one more if it casts shadows): reuse a layer with a different paint and finish before adding one.
- Drawn surfaces must stay within 2 cm of the knife solids in `packages/shared/src/world.ts` (`knifeSolids.test.ts`): round inward from a solid's box, stand trim at most a centimeter or so proud, keep rods and wires thin enough to pass, and draw a round shade's outside round its solid's circle, not inside it.
  Changing the solids changes the shared simulation (and `PROTOCOL_VERSION`).
- Fixture footprints, stations and doors live in `packages/shared/src/world.ts`; colliders, the minimap and the renderer all read them, so move things there, not in the client.
- E2E uses SwiftShader, which gets the low quality tier automatically; screenshots and perf use the real GPU and `?quality=high`.
- A protocol or shared-simulation change bumps `PROTOCOL_VERSION`; Vercel deploys the client on every push to `main`, but the AWS room server only with `npm run deploy:aws`, so until then visitors play solo.
- `infra/cdk.context.json` records the stack's lookups, the room server's AMI among them; commit it after a deploy writes it, and move to a newer AMI only on purpose (README's deployment section), since a new AMI replaces the instance.
  A server deploy succeeds only once the new instance answers `/ws/health`; keep the boot script's last step that check (`infra/test` asserts it).
- The look (evening service, after Ratatouille) is split by quality tier: `world/lighting.ts` has the lights for both, and the high tier adds shadows, the practical lights and `world/post.ts` (N8AO, bloom, AgX, the grade).
  Lamps and glowing things are the `light` layer, which shines past white on the high tier so bloom catches it; keep new glowing paint dim, or it blows out.
  Reflections come from a probe of the kitchen (`world/reflections.ts`), captured at load and when the hour's light moves on, box-projected in the shader (`world/surfaces/shading.ts`): every kitchen material has it as its own `envMap`, reflecting it at full strength and taking only `probeDiffuse` (0.05) of it as light, since a brighter environment lights everything from every side and flattens the room.
  Keep `scene.environmentIntensity` tiny too; it is what the cooks and knives get. three.js ignores a material's `envMapIntensity` whenever it reflects `scene.environment`, so set `envMap` on a material if its intensity should count.
- A GPU-bound frame is input lag, not just a lower frame rate (the browser queues frames). `world/governor.ts` steps the high tier's resolution, MSAA and AO down to keep up with the display; the level it settles on is stored in `localStorage` (`world.renderLevel`), so clear it when judging a visual change.
  Perf and screenshots run at device pixel ratio 1; check retina (ratio 2) too, where the high tier costs four times the pixels.
- The view outside the windows is real geometry in `world/outside.ts` (`OutsideView`, one unlit mesh), its light and haze baked into vertex colors, per corner (`smoothSolid`, `smoothFace`) so hills and crowns shade smoothly.
  `outside.test.ts` raycasts every pane and skylight; keep it passing when moving the land, the sky or the windows, or a visitor will see an edge.
- The light follows the visitor's local time (`world/timeOfDay.ts`): looks at hours of the day, blended between, repainted every quarter hour.
  `?time=20:00` pins the hour; screenshots use it, and so should anyone judging a lighting change (the evening look is the reference).
  In dev builds `?view=x,y,z,yaw,pitch` holds the camera behind the landing (`game/photoView.ts`), `&cooks=4` stands cooks in it facing the camera, and `&governor=off` holds the best render level.
- The hand on screen is solved, not keyed: `world/hand.ts` wraps it round each knife's handle (`knifeHand` in `world/viewmodel.ts`), so a new knife needs no hand work; `viewmodelHand.test.ts` checks every knife's grip, ring and wrist in the scene as drawn.
  Knives turn end over end only on the index finger, never in the fist, and fold through a hand that lets go; `viewmodelClearance*.test.ts` steps every knife through every move and cut and fails if it reaches deeper into the hand than its own grip does.
- The interface follows `docs/ui-revamp.md` (approved mockups in `docs/ui-revamp/`): no boxes, nothing behind or around words in the world (no outlines, glows or `text-shadow`), Gabarito for titles and Rubik for the rest, brass only for what is current, marked by the `.bar`, and keys as rings.
  Use the tokens in `styles/tokens.css` and the parts in `styles/controls.css`; each surface has its own stylesheet, imported in cascade order by `styles/app.css`.
  The fonts' latin subset has no arrows, so draw them.
- `portfolio.html` is written at build time from `content.ts` (a Vite plugin running `src/portfolioPage.ts`, through `ui/markup.ts`, which the station panel renders too), so the page works without JavaScript; change `content.ts`, never the built page.
- The room server ends any connection whose inputs are not numbered one after another (the first may start anywhere), since cooldowns and the knife's spread go by those numbers; bots and tests that send inputs must count up by one.
- The first player in a room spawns at `SPAWN`, by the dining room doors with the pass just ahead; E2E walking paths rely on that, strafing along the aisle or rounding the west end of the pass.
- E2E must hold on a busy machine, where a page can go seconds without a frame.
  Check that something did not happen only once the game has run frames (`waitForFrames`), the server says so (`server.room`), or the page has heard back; never after a fixed wait.
  Each `enterWorld` adds its own time to the test's (`ENTER_MS`), so set a long body's time with `test.setTimeout` before entering, and take `test` from `helpers.ts` in specs that start a room server, so a failure carries its log.
  The test build draws pages nobody is driving four times a second (`src/testDrawing.ts`); `E2E_CPU_THROTTLE` checks a spec on a starved page.
- The kitchen computer's firmware (`apps/client/src/computer/assets/doom.elf`) is committed prebuilt, because the site's builds have no RISC-V toolchain; after changing anything in `firmware/`, rebuild it with `firmware/doom/build.sh` and commit the ELF.
  `firmware/include/machine.h` and `src/computer/abi.ts` must agree (`abi.test.ts` checks).
  At the computer every key goes to DOOM except Esc, which steps away (under pointer lock the browser takes Esc anyway); DOOM's menu is on the backquote key, and the mouse takes `movementX` in CSS pixels (`KitchenComputer.mouseMove` scales it to DOOM's counts).

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
