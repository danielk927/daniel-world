# Progress

## Final summary

All milestones (M0 to M6) are done and committed on `main`.
The full definition of done passes from a fresh clone: `npm install`, `npm run lint`, `npm run typecheck`, `npm test` (84 tests), `npx playwright install chromium`, `npm run e2e` (10 tests, about 3 minutes), and `npm run build`.

### Live deployment

- **AWS (primary):** https://d1ivv0s5bbzyx0.cloudfront.net, stack `DanielWorld` in account 555300500704, `us-east-1`, deployed with `npm run deploy:aws`.
  CloudFront serves the S3 site and proxies `/ws` to EC2 instance `i-03569030fe5cd4036` (t4g.micro); logs go to CloudWatch log group `DanielWorld-ServerLogsD9948953-dzKBRdipDtL4`.
- **Vercel:** https://daniel-world-nine.vercel.app, with `VITE_SERVER_URL=wss://d1ivv0s5bbzyx0.cloudfront.net/ws`, so both front ends share one room server.
- Verified live: two browsers joined, saw each other, chatted and emoted (27 ms ping); the instance refuses direct connections and has no SSH.
- Cost is about $10/month (instance plus public IPv4), less on the free tier. `npm run destroy -w @world/infra` removes it all.
- GitHub: https://github.com/danielk927/daniel-world (public).

### What was built

- **A first-person 3D personal site**: a low-poly floating island at golden hour, built only from primitives and shaders.
  It has a sky, a cloud sea, fog, shadows, wind-swayed trees and grass, a fountain with a floating crystal, lanterns, drifting light motes, and distant islands.
- **Eight lore objects** (About, Projects, Experience, Skills, Contact, Now, Fun facts, Island notes) on pedestals.
  They highlight when you look at them and open an info panel when clicked.
- **Landing screen**: random name saved in localStorage, room code, live lobby count, and a "Skip to portfolio" link.
  There is also a loading screen, a pause menu with mouse sensitivity, and notices for devices without WebGL or without a mouse.
- **A static portfolio page** (`/portfolio.html`) rendered from the same `content.ts`.
- **Real-time multiplayer**:
  - Up to 16 players per room.
  - Client-side prediction with server reconciliation, and interpolated remote avatars with animations and name tags.
  - Chat with speech bubbles, and emotes (wave, dance, jump).
  - Private rooms with invite links.
  - Offline single-player mode with automatic reconnect.
- **A hardened room server** that validates every message with zod.
  It rate limits and disconnects floods, runs a heartbeat, caps connections, blocks speed hacks, and drops slow clients.
- **Tag**, a game mode for private rooms, with a scoreboard.
- **Performance** on an Apple M5 with 16 players: a steady 60 fps, about 1 ms of main-thread time per frame, and 61 draw calls.
  Software renderers automatically get a lighter quality tier.

### The kitchen (after the final summary)

- The floating island was replaced with a classical French brigade kitchen, at Daniel's request: a navy and brass piano under a steel hood, white tile, walls of copper, live flames and steam, and Paris at dusk through the windows.
- The eight stations (le passe, saucier, poissonnier, rôtisseur, entremetier, garde manger, pâtisserie, plonge) are the clickable objects, each with a placeholder panel describing the station.
  Linking stations to the personal sections is next, once Daniel decides the mapping.
- Avatars wear chef's toques.
- Restyled as low-poly: flat-shaded matte facets, low-sided round shapes, chamfered boxes, vertex colors instead of textures, a terracotta and cream checker floor, and faceted avatars.
- Re-laid out after the French Laundry (16 by 13 m, white vault and skylights, stainless suite, charcoal islands, garden windows, three star plaques), with The Bear's "Every Second Counts" sign, and far fewer pots and pans.
- Lint, typecheck, 120 unit tests, 10 E2E tests and the build pass; with 16 players it holds 60 fps at about 1.1 ms of frame CPU, 34 draw calls and 66k triangles.

### How to run it

```bash
npm install
npm run dev            # http://localhost:5173 (client) and :3001 (server)
npm run bots -- --count 5   # optional: some company
```

`README.md` has the controls, architecture, and deployment steps.
`CLAUDE.md` has the commands and conventions for future sessions.
`DECISIONS.md` records every judgment call.

### Known issues and limitations

- Pointer lock is not available in headless test browsers.
  E2E runs the drag-to-look fallback, so the pointer-lock path was only reasoned about, not driven automatically.
- On a real GPU the look was checked through headless-GPU screenshots (`docs/screenshots/`), not by a person in a headed browser.
  A quick manual pass would still be worthwhile.
- The Dockerfile in the README deployment section is untested (Docker was not available here).
  The Railway/Render and static-hosting steps only use commands that were run locally.
- Rooms live in one server process's memory, so the server must run as a single instance.
- Bit-exact prediction is guaranteed between V8 engines (Chrome, Edge, Node).
  Firefox and Safari may drift by tiny amounts, which reconciliation smooths out invisibly.
- The E2E suite takes about 3 minutes because several software-rendered browsers share one CPU.

### What needs Daniel's input

- **Real content**: replace every `TODO(daniel)` in `apps/client/src/content.ts` (tagline, intro, about, projects, experience, skills, contact links, now, fun facts).
- **Deployment accounts and domains**: a host for the server (Fly.io, Railway, or Render) and for the static client (Vercel, Netlify, or GitHub Pages).
  Then set `VITE_SERVER_URL` for the client build and `ALLOWED_ORIGINS` / `TRUST_PROXY` for the server.
- **Optional taste calls**: site title and eyebrow text (`site` in `content.ts`), the palette in `apps/client/src/world/palette.ts`, and whether tag should also be allowed in the public lobby.

## Milestones

- [x] M0 Scaffold
- [x] M1 Single-player world
- [x] M2 Room server
- [x] M3 Multiplayer client
- [x] M4 E2E
- [x] M5 Polish
- [x] M6 Stretch (game mode)

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

### M4 E2E

- `e2e/multiplayer.spec.ts`: two players see each other in the lobby; A's movement seen by B (and zero prediction corrections); chat A to B as plain text; private room isolation; closing A drops B to 1; Esc on an info panel returns to play.
- `e2e/offline.spec.ts`: with no server the world loads, shows solo mode and is walkable, then reconnects when the server starts.
- `e2e/smoke.spec.ts`: landing and portfolio.
- Stable across repeated runs (~2.5 min).

### M5 Polish

- `scripts/screenshots.ts` writes landing, world (with bots), pause, lore object, info panel, portfolio and mobile shots to `docs/screenshots/`.
- Visual fixes from reviewing them: lobby count showed "unavailable" on first paint, the info panel overlapped the player list, crosshair and hints now hide under menus, friendlier count wording.
- `scripts/bots.ts` and `scripts/perf.ts`: with 16 players on an Apple M5 (real GPU, high quality) the client holds 60 fps, ~1.0 ms main-thread time per frame, 61 draw calls, zero prediction corrections.
- Heap profiling found and removed the main per-frame garbage source (shadow depth program churn) and iterator allocations.
- Dead code removed (unused avatar helpers, label flag, protocol types); spawn points spread around the plaza.
- `README.md` with quick start, controls, content editing, architecture and a deployment section (server on Fly.io/Railway/Render, client on Vercel/Netlify/GitHub Pages); env examples for both apps.

### M6 Stretch: tag

- Server `TagRound` (apps/server/src/tag.ts) with unit tests: private rooms only, two-player minimum, tag on contact, no tag-backs for 3 s, scoring, round end, it leaving, late joiners.
- Client: "Play tag" in the pause menu, scoreboard with timer and ranking, IT badge on name tags, a floating red marker over whoever is it, toasts and chat announcements.
- E2E: a round starts from the menu and both players see the scoreboard.
- Screenshot: `docs/screenshots/tag.png`.

### Final review fixes

- Chat blur soft-lock, silent-connection detection, quieter live region, Esc toggles pause, closed dialogs release focus, frame-rate-independent E2E walking.

## Next

- Nothing required. See "What needs Daniel's input" above.
