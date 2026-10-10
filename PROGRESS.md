# Progress

## Where things stand (2026-10-10)

Daniel's World is a first-person, multiplayer French brigade kitchen: visitors are cooks, the eight stations serve the sections of Daniel's resume, his five favorite dishes wait on the pass under their heat lamps, and everyone in a room sees everyone else in real time.
Around that: knives to throw (twelve CS2-style skins, a little spread on every throw), Chef Skinner walking the lobby, a walk-in cooler that bursts open after ten hits, and a RISC-V computer running DOOM.
The plain portfolio page renders the same content, written into `portfolio.html` at build time so it works without JavaScript.

The work of 2026-10-09 and 10, at Daniel's request, all committed on `main` and not yet pushed:

- **Higher quality graphics**: the kitchen left the low-poly style (GPU-painted surfaces at real size, reflections from a probe of the room, rounded forms, modeled food and props, smoother cooks), and so did the hand on screen (a glove and a chef's sleeve) and the knives.
- **Knives clear of the hand**: every knife's moves were measured frame by frame and rebuilt so no knife passes through the hand.
- **Every plate on the pass lit** by its own heat lamp.
- **A review of every part of the code**, by area and then a second pass (server, client, interface, rendering, infrastructure, kitchen computer, docs, tests), and fixes for what it found: a socket that could crash the room server, cooldowns that could be skipped, a dead network still shown as online, the knockout card and menus, focus and contrast, the walk-in door's knives, the quality governor, a safer AWS stack, and an E2E suite that holds on a busy machine.
- Not built: locking Chef Skinner in the walk-in, whose spec (`docs/superpowers/specs/2026-10-09-caged-chef-design.md`) waits for Daniel's review.

### Live deployment

- **AWS (primary):** https://d1ivv0s5bbzyx0.cloudfront.net, stack `DanielWorld` in account 555300500704, `us-east-1`, deployed with `npm run deploy:aws`.
  CloudFront serves the S3 site and proxies `/ws` to EC2 instance `i-0d43c69c81a9b7a5f` (t4g.micro); logs go to CloudWatch log group `DanielWorld-ServerLogsD9948953-dzKBRdipDtL4`.
- **Vercel:** https://daniel-world-nine.vercel.app, with `VITE_SERVER_URL=wss://d1ivv0s5bbzyx0.cloudfront.net/ws`, so both front ends share one room server.
- Verified live: two browsers joined, saw each other and chatted (27 ms ping); the instance refuses direct connections and has no SSH.
- `main` is ahead of the live site: protocol version 8 and a reworked stack.
  Pushing redeploys the Vercel front end at once, while the room server follows only with `npm run deploy:aws` (see "What needs Daniel's input").
- Cost is about $10/month (instance plus public IPv4), less on the free tier. `npm run destroy -w @world/infra` removes it all.
- GitHub: https://github.com/danielk927/daniel-world (public).

### The first build (a floating island, since replaced)

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

### The kitchen

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

### A safer AWS stack (2026-10-09, not deployed)

- A server deploy now waits for the new instance's health check and rolls back if it fails; CloudFront reaches the server by an Elastic IP that survives a stop and start; the AMI stays as recorded in `infra/cdk.context.json`; the instance reads only its own bundle; the site's hashed files stay cached and are never deleted under open tabs; the server log is bounded by size.
- The bots always leave a seat for the developer and keep their timings in seconds at 60 Hz; perf and screenshots stop everything they start, however they end; the screenshots' own server has Chef Skinner in.
- Before the next `npm run deploy:aws`: it replaces the instance once (rooms drop, players reconnect), creates the Elastic IP and moves CloudFront's `/ws` origin to it (a distribution update, several minutes); afterwards commit `infra/cdk.context.json` and check `dig +short <ServerOrigin output>` prints the Elastic IP.
- Lint, typecheck, 926 unit tests and the build pass; a local synth shows the changes; `node scripts/perf.ts` on spare ports reports 16 players at 60 fps and leaves nothing running.

### The client game after review (2026-10-09)

- The findings from a review of the client's game and networking code, each reproduced by a failing test first, end to end where a visitor would meet it.
- Connection: a network gone quiet now turns solo in seconds instead of up to a minute, a late ping (the page held up) judges no silence, a socket the browser will not make no longer breaks entering the world, a room that fills while the server is away keeps the cook in the kitchen solo instead of sending them to the landing, and a new connection's inputs no longer carry the last session's view.
- Knockouts: no arm under the menu at the respawn, no labels over the knockout card, nothing picked or opened from the floor, and screen readers hear it once.
- The pause menu and station panels close with Esc after a click on their words or their dark; the panel had the same bug the review put only on the menu.
- The kitchen computer: leaving the window or tab steps away, the auto-repeat of the E that sits a cook down stays out of DOOM, Ctrl and Alt are no longer DOOM keys (Ctrl+W closed the tab, Ctrl+Tab and Alt+Tab switched away), and a crash after boot shows the standby screen and says so.
- A kitchen that fails to load offers the portfolio instead of a loading screen up forever.
- Still protocol version 8.
- Lint, typecheck, 941 unit tests, 36 E2E tests and the build pass.

### The interface and content after review (2026-10-09)

- Seventeen findings from a review of the interface, its styles and the content, each confirmed in the code and, where a visitor would see it, reproduced in a browser first.
- The portfolio is written into `portfolio.html` at build time, so it reads with JavaScript off and link previews see the right name; without JavaScript the world shows the landing's way into it instead of loading forever.
- Tab stays in the pause menu and panels on what the keyboard can reach; labels draw under the HUD, the prompt and the hit flash; the knife grid's arrow keys go straight down on a phone; the loadout and map line up with the chat and the players; a full room in a short window folds its list before the loadout.
- Faint words hold 4.5:1 over the dark sides and the landing, measured on the real kitchen at 8 p.m. and noon (the faint ink and the landing's dim went up).
- The words agree everywhere (party code, Leave the kitchen, Plain portfolio, the black truffle croissant, the real controls), the portfolio's contact links are text links, and dead content and styles are gone.
- Lint, typecheck, 954 unit tests, 40 E2E tests and the build pass.

### E2E on a busy machine (2026-10-09)

- The suite holds on a loaded machine with no retries: in the test build pages nobody drives draw four times a second, each page a test enters adds its own time, the room server runs in its own process and a failed test carries its log, traces skip the screencast, and a check that nothing happened waits for the game, the server or an echo instead of a fixed time.
- New end-to-end checks: the no-WebGL landing, the landing's live lobby count, jumping and sprinting, remote name tags, holding the button to keep throwing, and a private party finding itself again after a server restart.
- Lint, typecheck, 954 unit tests and the build pass; the 45 E2E tests passed twice in a row in 8.3 minutes each at a load of 8 to 14 on 10 cores (29 tests took 10.3 minutes before, at 20 to 28), and the multiplayer, Karambit and Chef Skinner specs pass with every page's CPU 4x slower.

### The knife clear of the hand (2026-10-10)

- Knives no longer pass through the hand on screen: measured every frame of every knife's moves and cuts, the knife reached up to 13 mm into the hand, through the palm, for 11 of 12 knives; now 6.8 mm at most, never more than 2.3 mm past the knife's own grip.
- Every knife turns end over end on the index finger, the hand pointing, by its ring or its spine; folding blades and the butterfly's handle swing as hinges through a hand that lets go; a knife cut short mid-spin settles upright on the finger before coming back; a knife turned in the hand is held looser; the skeleton knife's loop takes the finger.
- `viewmodelClearance*.test.ts` checks every knife, move and cut; it fails on the old animations.
- Lint, typecheck, 966 unit tests, 40 E2E tests and the build pass.

### The graphics upgrade (2026-10-10)

- The kitchen leaves the low-poly style, at Daniel's request (`docs/graphics-upgrade.md` has the direction, the audit and the results; before and after frames from twelve viewpoints are in `docs/graphics-upgrade/`).
- Every surface is painted on the GPU at load at its real size, from recipes in the code (stone floor tiles, large glazed wall tiles, plaster, brushed steel, cast iron, hammered copper, brass, stone, butcher block, cloth, food), with texture coordinates in meters and a finish per part; nothing is downloaded.
- Every kitchen material reflects a probe of the kitchen, box-projected so a lamp's reflection lands under the lamp; three.js had been ignoring the metals' reflection strength, which is much of why the steel read as grey paint.
- Real forms: rounded edges, a true barrel vault, a French range with brass bands and knobs, baffle filters, turned pots, pans, plates and bottles, modeled food and five remade dishes, smooth cooks with a pleated toque, buttons and an apron.
- Grounding: contact shade and wear on the floor painted from the layout, the islands' lamps casting shadows drawn once, the heat lamps kept off the floor, the hood lit by three downlights.
- Found on the way: both signs had gone blank (their pictures stretched by meter coordinates), and loading cloned a default shape for every part; both fixed.
- With 16 players it holds 60 fps at governor level 0 at dpr 1 and level 1 at dpr 2, at about 0.8 ms of frame CPU, 86 draw calls and 709 k triangles; uncapped it draws about 30 % fewer frames than before (131 against 185 fps); the high tier loads in 1.03 s instead of 0.90, the low tier in 0.96.
- The low tier keeps plain paint on the same geometry, with fewer sides, and no textures, probe or post-processing.
- Lint, typecheck, 960 unit tests, 40 E2E tests and the build pass.

### The hand and knives at the kitchen's standard (2026-10-10)

- The hand on screen is a satin glove in the player's color with a chef's sleeve, and the knives are smooth where round and crisp at spine and edge, with steel that reflects the kitchen and handles of wood, micarta, G10, rubber or cord; the shapes the clearance tests check did not move.

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
- Rooms live in one server process's memory, so the server must run as a single instance.
- Bit-exact prediction is guaranteed between V8 engines (Chrome, Edge, Node).
  Firefox and Safari may drift by tiny amounts, which reconciliation smooths out invisibly.
- The E2E suite takes about 8 minutes, as several software-rendered browsers share one CPU.

### October 7 additions

- Movement: 60 Hz shared simulation, camera drawn between the last two ticks (no more pops when changing direction).
- The clock hangs over the dining room doors.
- Daniel's resume on every station and the portfolio page.
- Chef Skinner can be switched off per visitor in Settings.
- Private parties from the pause menu, moved into in place.
- The kitchen computer: DOOM on a RISC-V machine in a Web Worker.
- Protocol version 7; the AWS room server needs `npm run deploy:aws` for multiplayer to match the client.

### What needs Daniel's input

- **Pushing and deploying.** Nothing from 2026-10-09 and 10 is pushed.
  Protocol version 8 means the room server must be redeployed with the client: push, then `npm run deploy:aws`, or the Vercel front end plays solo until the deploy.
  That deploy replaces the room server's instance once (rooms drop, players reconnect), gives it an Elastic IP and moves CloudFront's `/ws` origin to it; afterwards check that `dig +short` on the `ServerOrigin` output prints the Elastic IP, and commit `infra/cdk.context.json`, which it writes.
- **The caged chef spec** (`docs/superpowers/specs/2026-10-09-caged-chef-design.md`): review it before it is built.
- **Taste calls**: the landing's dim is deeper (for the small text's contrast); the new kitchen look; the bayonet, M9 and huntsman spins, whose blade the fist hides half of each turn.
- **His words**: the two `TODO(daniel)` lines in `content.ts`, and whether "pending for NeurIPS and Nature" and "pending for AAAI and AISTATS" should read "under review at".
- **`AGENTS.md`**: an untracked, out-of-date copy of an old `CLAUDE.md` in the checkout; delete it or regenerate it from `CLAUDE.md`.

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

- Push and deploy, after reviewing (see "What needs Daniel's input").
- Lock Chef Skinner in the walk-in, once Daniel has reviewed its spec.
