# Progress

## Milestones

- [x] M0 Scaffold
- [x] M1 Single-player world
- [ ] M2 Room server
- [ ] M3 Multiplayer client
- [ ] M4 E2E
- [ ] M5 Polish
- [ ] M6 Stretch (game mode)

## Log

### M0 Scaffold

- npm workspaces: `packages/shared`, `apps/server`, `apps/client`.
- Scripts: `dev`, `build`, `lint`, `typecheck`, `test`, `e2e` all run green on placeholder code.
- Configs: ESLint (type-aware) + Prettier, Vitest projects, Playwright (Chromium + SwiftShader).
- `CLAUDE.md` with commands, map, conventions, verification.

### M1 Single-player world

- Shared: world layout (terrain height function, fountain, 8 pedestals, trees, rocks, ruins with a walkable stair), colliders, deterministic `stepPlayer`, text sanitizers, with unit tests.
- Client: loading screen, landing card (name with shuffle + localStorage, room code, live count slot, portfolio link), no-WebGL and touch notices.
- World: golden-hour sky shader, cloud sea shader, fog, hemisphere + shadowed sun, low-poly terrain and cliff, rim wall with lanterns, tiled plaza, fountain with floating crystal, instanced trees/rocks/grass/flowers with wind sway, drifting motes, distant islands.
- Controls: pointer lock (with drag-look fallback), WASD/arrows, Space, Shift, head bob, landing dip, sprint FOV.
- Lore objects with hover highlight, prompt, labels, and an info panel; pause menu with sensitivity; portfolio page from the same `content.ts`.

## Next

- M2: protocol (zod), room server, tick loop, validation, rate limiting, heartbeat, tests.
