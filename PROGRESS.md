# Progress

## Milestones

- [x] M0 Scaffold
- [x] M1 Single-player world
- [x] M2 Room server
- [x] M3 Multiplayer client
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

### M2 Room server

- `packages/shared/src/protocol.ts`: zod schemas for every client and server message, `parseClientMessage` / `parseServerMessage`.
- `apps/server`: HTTP + WebSocket server, rooms (max 16, distinct colors), drift-corrected 20 Hz tick loop, input credit, chat/emote relay, rate limiting with flood disconnect, heartbeat, hello timeout, `/health` and `/rooms/:code`.
- Tests: protocol accept/reject cases, token bucket and strikes, room behavior, server-vs-client determinism over 600 ticks through JSON, and WebSocket integration tests (join, movement, chat, isolation, leave, full room, version, invalid messages, flooding, heartbeat, HTTP count).
- Found and fixed: quantized `-0` did not survive JSON, which broke bit-exact reconciliation.

### M3 Multiplayer client

- `net/connection.ts`: hello handshake, zod-validated messages, RTT pings, jittered exponential backoff, fatal errors (room full, version).
- `game/localPlayer.ts`: prediction with a pending-input ring buffer, reconciliation by replay, smoothed corrections (unit tests with a fake server: zero corrections without loss, exact convergence with loss).
- `net/interpolation.ts`: ring-buffer snapshot interpolation and a jitter-absorbing server clock (unit tests).
- `world/avatars.ts`: instanced, animated avatars; DOM name tags with chat bubbles.
- HUD: room, connection status with ping or retry countdown, player list; chat with 120-char limit and counter; emotes on 1/2/3; offline single-player mode.
- Review fixes folded in: Esc in the info panel no longer opens the pause menu; pedestals and the fountain column can no longer be climbed into; landing sweep for fast falls; cursor picking without pointer lock; server ghost-join, backpressure, connection caps, idle-fall, tick-loop resilience, duplicate names, invisible characters, malformed URL crash.
- Manually verified with two headless browsers: join, see each other, movement, chat with bubble, wave and dance.

## Next

- M4: Playwright E2E suite through `window.__world`.
