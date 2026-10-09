# Progress

## Final summary

All milestones (M0 to M6) are done and committed on `main`.
The full definition of done passes from a fresh clone: `npm install`, `npm run lint`, `npm run typecheck`, `npm test` (84 tests), `npx playwright install chromium`, `npm run e2e` (10 tests, about 3 minutes), and `npm run build`.

### Live deployment

- **AWS (primary):** https://d1ivv0s5bbzyx0.cloudfront.net, stack `DanielWorld` in account 555300500704, `us-east-1`, deployed with `npm run deploy:aws`.
  CloudFront serves the S3 site and proxies `/ws` to EC2 instance `i-0d43c69c81a9b7a5f` (t4g.micro); logs go to CloudWatch log group `DanielWorld-ServerLogsD9948953-dzKBRdipDtL4`.
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
- **Tag**, a game mode for private rooms, with a scoreboard (later replaced by knives).
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

### Knives (2026-10-03)

- Every cook carries knives in every room; a click throws one, and it sticks where it lands or knocks out the cook it hits.
- Knocked-out cooks fall over, see who did it, and respawn after 3 s with 2 s of protection.
- The server decides every hit, rewinding the other players to what the thrower saw; clients replay each flight with the shared simulation.
- The tag game mode was removed.
- With 16 players and bots throwing, it holds 60 fps at about 1 ms of frame CPU and 36 draw calls.
- Deployed to AWS the same day (protocol version 3); a live two-player check on both the AWS and Vercel sites knocked a cook out and saw them respawn.
- Then a CS2-style arm: the throw plays on a view model, Q switches to the bare hand, and knives fly faster (protocol version 4, deployed).
- Then CS2 and Valorant controls: left click throws (hold to keep throwing), E opens stations, I inspects the knife, and a loadout over the minimap shows what is in hand and the knife refilling.
- Then emotes were removed (protocol version 5), and the controls hint cut down to WASD, Space, Shift, Q and I.
- Then the bare hand punches (others see it, protocol version 6), I inspects only the knife, and the landing card is centered.

### The look (2026-10-05)

- Relit as evening service after Gusteau's kitchen in Ratatouille: blue hour through the windows and skylights, the kitchen lit by its own lamps in warm pools (heat lamps on the pass, new brass pendants over the islands, the hood, cove light along the vault), soft reflections on steel and copper.
- High quality post-processing: warm-tinted ambient occlusion, bloom, AgX tone mapping, a warm-blacks grade, vignette and grain; beams of light under the lamps.
- The low quality tier keeps the evening look without shadows, practical lights or post-processing.
- 60 fps with 16 players at about 2.1 ms of frame CPU and 72 draw calls.
- Input lag cut: the high tier now steps its own resolution, MSAA and ambient occlusion down when the GPU falls behind the display (retina screens ran at about 52 fps, queueing frames), and movement is drawn toward the next tick with the keys held now, so a key shows on the next frame instead of up to 48 ms later.

### The interface revamp (2026-10-08)

- Every overlay redone in one system (`docs/ui-revamp.md`): no boxes, the blue-hour dark as the container, Gabarito and Rubik, brass only for what is current with a short bar under it, keys as rings, and nothing behind or around words in the world.
- A centered landing with "Doyoon (Daniel) Kim" and "CS + Statistics @ UChicago" over a camera walking a slow lap of the kitchen; a loading screen to match; the station panel as a column on the right; section-only labels and plain name tags; a HUD of plain words; a round minimap with the knife over the fist; the pause menu with tabs down the left; and the portfolio in the same voice.
- Built by six agents in parallel worktrees on a shared groundwork, merged into `main`.
- Fixed on the way: nothing in front of the east wall could be picked while the walk-in was shut (the plonge among them).
- Lint, typecheck, 883 unit tests, 27 E2E tests and the build pass.

### Knife spread (2026-10-09)

- Every knife leaves the hand up to 1.5° off the crosshair, any way equally, so knives thrown at one spot scatter round it, yet a throw at the middle of a cook standing still hits them anywhere along the kitchen.
- The spread is a hash of the thrower's id and the input's sequence number, so the room and the thrower's own screen launch the same knife and everyone else replays it; Chef Skinner's knives spread too.
- Protocol version 8; the AWS room server needs `npm run deploy:aws` for multiplayer to match the client.
- Lint, typecheck, 889 unit tests, 28 E2E tests and the build pass.

### The room server after review (2026-10-09)

- Seven findings from a review of the room server, each reproduced by a failing test first: a turned-away socket's oversized frame crashed the server; inputs numbered out of turn skipped every cooldown and picked the knife's spread; the first `X-Forwarded-For` entry let anyone past the per-address cap behind CloudFront; a second knife into a cook on the same tick vanished; prefs changes went to everyone unlimited; a spawn hint's turn was unbounded; and the lobby's HTTP maximum counted Chef Skinner's place.
- Found on the way: a connection that stalled for 3 s was kicked as a flooder when its inputs arrived together; the message limit now takes 6 s of them at once.
- Still protocol version 8.
- Lint, typecheck, 916 unit tests, 29 E2E tests and the build pass.

### The client game after review (2026-10-09)

- The findings from a review of the client's game and networking code, each reproduced by a failing test first, end to end where a visitor would meet it.
- Connection: a network gone quiet now turns solo in seconds instead of up to a minute, a late ping (the page held up) judges no silence, a socket the browser will not make no longer breaks entering the world, a room that fills while the server is away keeps the cook in the kitchen solo instead of sending them to the landing, and a new connection's inputs no longer carry the last session's view.
- Knockouts: no arm under the menu at the respawn, no labels over the knockout card, nothing picked or opened from the floor, and screen readers hear it once.
- The pause menu and station panels close with Esc after a click on their words or their dark; the panel had the same bug the review put only on the menu.
- The kitchen computer: leaving the window or tab steps away, the auto-repeat of the E that sits a cook down stays out of DOOM, Ctrl and Alt are no longer DOOM keys (Ctrl+W closed the tab, Ctrl+Tab and Alt+Tab switched away), and a crash after boot shows the standby screen and says so.
- A kitchen that fails to load offers the portfolio instead of a loading screen up forever.
- Still protocol version 8.
- Lint, typecheck, 932 unit tests, 36 E2E tests and the build pass.

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

### October 7 additions

- Movement: 60 Hz shared simulation, camera drawn between the last two ticks (no more pops when changing direction).
- The clock hangs over the dining room doors.
- Daniel's resume on every station and the portfolio page.
- Chef Skinner can be switched off per visitor in Settings.
- Private parties from the pause menu, moved into in place.
- The kitchen computer: DOOM on a RISC-V machine in a Web Worker.
- Protocol version 7; the AWS room server needs `npm run deploy:aws` for multiplayer to match the client.

### What needs Daniel's input

- **Real content**: done (Daniel's resume on every station and the portfolio). Remaining `TODO(daniel)`: a personal line on the NBA or fashion, and optional lines on the dishes.
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
- [x] M6 Stretch (game mode; tag, since replaced by knives)

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

Removed on 2026-10-03 in favor of knife throwing in every room.

- Server `TagRound` (apps/server/src/tag.ts) with unit tests: private rooms only, two-player minimum, tag on contact, no tag-backs for 3 s, scoring, round end, it leaving, late joiners.
- Client: "Play tag" in the pause menu, scoreboard with timer and ranking, IT badge on name tags, a floating red marker over whoever is it, toasts and chat announcements.
- E2E: a round starts from the menu and both players see the scoreboard.
- Screenshot: `docs/screenshots/tag.png`.

### Final review fixes

- Chat blur soft-lock, silent-connection detection, quieter live region, Esc toggles pause, closed dialogs release focus, frame-rate-independent E2E walking.

## Next

- Nothing required. See "What needs Daniel's input" above.
