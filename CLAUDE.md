# Daniel's World - project guide

A first-person 3D multiplayer personal website.
Visitors walk a small floating island, click lore objects to learn about Daniel, and see each other in real time.
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
```

## Map

- `packages/shared` - protocol (zod schemas), constants, world colliders, deterministic movement simulation.
  Consumed as TypeScript source by both apps (no build step).
- `apps/server` - Node WebSocket room server (`ws`).
  Runs TypeScript natively in dev (`node --watch src/index.ts`), bundled with esbuild for production.
- `apps/client` - Vite + Three.js client.
  `src/content.ts` holds all personal content (placeholders marked `TODO(daniel)`).
  `index.html` is the 3D world, `portfolio.html` is the static fallback.
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
