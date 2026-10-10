# Decisions

Judgment calls made during the unattended build, with reasons.

## Tooling

- **TypeScript 6.0, not 7.0.**
  `typescript-eslint` 8.71 supports `typescript <6.1`, so 6.0.x keeps type-aware linting working.
- **Server runs TypeScript natively in dev** (`node --watch src/index.ts`, Node >= 22.18 strips types).
  No `tsx`/`ts-node` dependency.
  This requires erasable-only syntax and explicit `.ts` import extensions, enforced by `erasableSyntaxOnly` and `allowImportingTsExtensions`.
- **Server production build is an esbuild bundle** (`apps/server/dist/index.js`) with only `ws` left external, so deploy targets need no TypeScript support and no workspace linking.
- **Shared package ships TypeScript source** (`exports` points at `src/index.ts`).
  Vite, Vitest, Node and esbuild all consume it directly, so there is no build ordering between workspaces.
- **E2E runs against a `--mode test` production bundle** served by `vite preview` on :5174, with its own room server on :3101.
  This exercises the real bundle while keeping `window.__world` available, and does not collide with `npm run dev`.
- **Commits go directly on `main`.**
  The repository had no commits and no remote; the spec asks for a local commit per milestone.

## World and gameplay

- **Shared simulation was built in M1, not M2.**
  M1 needs collisions, and writing them once in `packages/shared` means the server reuses exactly the same code later.
- **Fixed 20 Hz simulation on the client too, rendered with interpolation.**
  The local player steps the shared sim once per tick (the same tick the input is sent), and the camera renders between the last two ticks.
  Mouse look is applied every frame, so aiming never waits for a tick.
- **State is quantized to 1e-4 inside the sim.**
  This keeps snapshots compact and makes client and server results identical after a JSON round trip.
- **Boundary is a visible low stone wall at the rim plus a radius clamp.**
  Falling off is impossible; a respawn safety net exists anyway for `y` out of range.
- **Eight lore pedestals, fixed by the shared layout.**
  The spec allows 6 to 8; eight gives a symmetric ring.
  `content.ts` supplies one entry per pedestal (About, Projects, Experience, Skills, Contact, Now, Fun facts, Island notes).
- **Placeholders read as neutral sample text in the UI**, and every one is tagged with a `// TODO(daniel)` comment in `content.ts`.
  Showing "TODO" strings on screen would make screenshots look broken.
- **Pointer lock is preferred but optional.**
  If the browser refuses (headless, cooldown after Esc, unsupported), the game keeps running with click-and-drag look.
  This also keeps the controls testable in headless Chromium.
- **Labels and name tags are DOM elements**, positioned every frame.
  Text stays crisp and costs no draw calls; 24 labels is trivially cheap.
- **No post-processing.**
  Glows are additive sprites and emissive materials, which keeps the frame budget for 16 avatars on laptop GPUs.
- **Fonts are bundled, not fetched:** EB Garamond for titles and Jost for the interface, self-hosted from npm (`@fontsource`) so the site still needs no outside service. (They were system stacks until the navy restyle.)
- **`?room=code` prefills the room field**, so private rooms can be shared as links.
- **Server URL default is `ws://<page host>:3001`** rather than a hard-coded `localhost`, so LAN devices work in dev; `VITE_SERVER_URL` overrides it.

## Networking

- **One JSON message per WebSocket frame, discriminated by `t`.**
  Snapshots at 20 Hz for 16 players are about 30 KB/s per client, fine for this scale; a binary format would add complexity for no visible gain.
- **Snapshots carry full state for every player** (position, velocity, look, grounded, last acked input).
  One serialized string is shared by all recipients each tick.
- **Input credit instead of trusting client timing.**
  Each player earns one simulation step per server tick, banking at most 6, and the input queue is capped at 8 (oldest dropped).
  A client cannot move faster than the simulation allows no matter how fast it sends.
- **Reconnect spawn hint.**
  `hello` may carry the player's last position; the server clamps it to the rim and runs one settle step (pushes out of colliders, snaps to ground).
  Worst case a player teleports somewhere they could have walked to, which is harmless here.
- **Rate limiting:** a 60-token bucket refilling at 40/s for all messages, plus separate chat (burst 4, 1 per 2 s) and emote buckets.
  Rate-limited and invalid messages add leaky strikes (limit 40, leaking 10/s); crossing the limit closes the socket with 1008.
- **Heartbeat** pings every 10 s and terminates sockets that missed a pong; sockets that do not send `hello` within 10 s are closed.
- **Lobby count over HTTP** (`GET /rooms/:code`) on the same port, so the landing page can show it without opening a socket.
- **Empty rooms are deleted immediately**; room codes are normalized to `a-z0-9-` and default to `lobby`.
- **Server hardening after review:** sockets being dropped are marked `closing` and removed from their room immediately (a rejected socket used to be able to join during the close handshake), then force-terminated after 1 s.
  Slow readers over 256 KB of buffered output are dropped; connections are capped (1000 total, 20 per IP, `trustProxy` for `x-forwarded-for`); optional `allowedOrigins`.
- **Silent players keep falling.** After 10 ticks without input the server steps them with an idle input, so going quiet mid-jump cannot be used to hover.
- **Duplicate names get a number** (`Otter 2`) within a room, and names/chat strip control, format and default-ignorable characters.
- **Only the lobby count is public over HTTP;** private room occupancy is not revealed.
- **Determinism note:** V8 (Chrome, Node) produces identical `Math.sin`/`Math.cos` results, so Chromium clients never need corrections.
  Other engines may differ in the last bit; reconciliation plus a 12/s visual error decay hides any such drift, so no custom trig was added.

## Multiplayer client

- **Remote players render 100 ms behind a clock that tracks the fastest observed snapshot delivery.**
  Jitter is absorbed by the delay; extrapolation past the newest snapshot is capped at 150 ms, then the avatar holds still.
- **Corrections under 4 m are blended out** (exponential decay); bigger ones (respawn, reconnect) snap.
- **Avatars are 4 instanced meshes for all players** (body, head, hands, eyes), animated per frame by writing instance matrices: walk bob and arm swing, air stretch, head pitch, and wave/dance/jump emotes.
- **Chat is shown on the sender's screen only when the server echoes it**, so what you see is what everyone saw; offline sends show a local notice instead.
- **Chat bubbles** appear above the speaker's name tag for 6 s.
- **Emotes are also announced in the chat log**, and the local player gets a toast (first person cannot see its own avatar).
- **Reconnect uses jittered exponential backoff** (1 s doubling to 15 s) and rejoins at the player's current position; a "Reconnected" toast confirms it.
- **Private rooms get a "Copy invite link" button** in the pause menu (`?room=code`).

## Testing

- **E2E runs the room server in the Playwright process** (`e2e/helpers.ts` imports `startServer`), so tests can stop and restart it; the offline test also verifies automatic reconnection.
- **E2E asserts on `window.__world`** (mode, connection, room, self id, local position, remote players with positions, player count, prediction stats, renderer stats), plus accessible roles for UI (chat history, dialogs, status).
- **Quality tiers.** A software WebGL renderer (SwiftShader, llvmpipe) is detected via `WEBGL_debug_renderer_info` and gets low quality: no shadows, no MSAA, 0.75 render scale, 3-octave clouds.
  This keeps the world usable for visitors without a GPU and keeps multi-page E2E fast.
  `?quality=high|low` overrides it (docs screenshots use `high`).
- **E2E contexts use a 960x540 viewport and a 120 s per-test timeout**, because several software-rendered pages share one CPU.

## Polish

- **Spawn points are spread around the plaza** by golden-ratio steps, facing the fountain; the first player in a room gets the main spawn (keeps E2E paths deterministic).
  Reconnects still rejoin at the player's own position.
- **Avatars live in `WorldScene` from the start**, so their shaders compile behind the loading screen rather than hitching when the first visitor appears.
- **Shadow depth materials per instancing variant** (`world/shadowDepth.ts`).
  A heap profile showed three.js recomputing program parameters for every shadow caster every frame, because one shared depth material alternated between instanced and plain meshes; this removed most per-frame garbage.
- **Per-frame loops use indexed `for` and a pre-bound `forEach` callback** instead of `for...of`, which allocated iterators in the sim, labels and remote-player update.
  What remains in the heap profile is engine-level (number boxing, three.js uniform uploads) and snapshot JSON parsing.
- **Screenshots and the perf report use headless Chromium on the real GPU** (`--use-angle=metal`); E2E keeps SwiftShader as the spec asks.
- **Deployment is documented, not scripted.**
  No Docker or platform CLIs were available, so the Dockerfile in the README is marked untested; the Railway/Render and static hosting steps only use commands that were run here.

## Game mode (M6)

> Removed on 2026-10-03: Daniel wanted no game modes, only knife throwing in every room. The notes below record what tag was.

- **Tag, in private rooms only.** The lobby is for wandering; a game there would hijack everyone's visit.
- **Server-authoritative rules:** the server picks who is it, detects tags (1.3 m horizontally, similar height) after each simulation tick, and keeps score.
  Clients only ask to start a round.
- **Score = seconds spent not being it; highest wins.** Rounds last 90 s; a freshly tagged player cannot tag the tagger back for 3 s.
- **Round state is broadcast once a second and on every tag**, and the client counts the timer down locally in between.
  Late joiners get the state right after `welcome` and join the scoreboard at 0.
- **If it leaves, it passes to a random remaining player**; if fewer than two players remain, the round ends.
- **Started from the pause menu ("Play tag")**, next to "Copy invite link", so the flow is: make a private room, share the link, press Play tag.

## Final review fixes

- **Chat closes when its input loses focus** (for example clicking the world), so the keyboard can never be left waiting on a chat nobody is typing in.
- **Four seconds without any server message counts as a dead connection** and triggers the normal reconnect; pings go out every second so a quiet room still proves liveness.
- **The connection status live region only announces changes** (connected, connecting, offline); the ping and retry countdown are visual only.
- **Esc toggles the pause menu**, and closing a dialog gives focus back to the page (a hidden dialog was swallowing the next Esc).
- **E2E walks until a position is reached** instead of holding keys for fixed times, and allows a small prediction correction on starved CI machines (exactness is covered by unit tests).

## AWS deployment

- **CDK in TypeScript** (`infra/`), run by Node's native type stripping like the server, so the infrastructure is reviewed, tested (`infra/test`) and deployed from the repo.
- **CloudFront in front of both S3 and EC2 on one domain.**
  It provides TLS for `wss://` without buying a domain or managing certificates, and CloudFront supports WebSockets natively.
  The client is built with `VITE_SERVER_URL=/ws`, which it resolves against the page origin; the server strips the `/ws` prefix from its HTTP routes via `BASE_PATH`.
- **EC2 over Fargate or App Runner.** App Runner does not support WebSockets; Fargate needs a load balancer (about $16/month before any compute).
  A single t4g.micro (Graviton) fits one in-memory room server and is free-tier eligible.
- **No NAT gateway, one public subnet, security group restricted to the CloudFront origin-facing prefix list.**
  The instance has a public IP only so CloudFront can reach it; nothing else can.
- **No SSH.** Access is through Systems Manager Session Manager; the instance role has only SSM, its code bundle and its log group.
- **Immutable server deploys:** the server bundle is a CDK asset referenced by user data with `userDataCausesReplacement`, so a new build replaces the instance.
  This briefly disconnects players (they reconnect automatically), which is fine for a personal site.
- **Pinned, checksum-verified Node.js** downloaded at boot, instead of distribution packages whose versions drift.
- **The server bundle now includes `ws`** (esbuild with a `createRequire` banner), so any host needs only Node.js.
- **Known audit finding:** `npm audit` reports a `brace-expansion` advisory inside `aws-cdk-lib`'s bundled dependencies.
  It cannot be patched from here and only runs at deploy time on our own inputs, never in the site or server.

## Minimap

- **North-up, fixed orientation** with the player as a rotating arrow and view cone, so the island reads like a map rather than spinning with the camera.
- **2D canvas, not a second WebGL view.** The island layer (grass, rim, plaza, fountain, trees, rocks, ruins, pedestals) is drawn once to an offscreen canvas; each redraw blits it and adds the player dots.
  Redraws run at 30 Hz. Measured cost with 16 players is about 0.1 ms per frame.
- **Shapes carry meaning:** circles are players (in their colors, red ring for whoever was it in tag, before tag was removed), diamonds are lore pedestals (stations, since the kitchen replaced the island; the map is now a rectangle).
- **Hidden under menus and on small screens**, like the player list; the controls hint now hides below 1000 px wide so it never collides with the map.

## The kitchen (replacing the island)

- **The world is a classical French brigade kitchen at real scale; players are the cooks.**
  Daniel asked for a setting that is personal (he worked in a Michelin-starred kitchen), and for a super classical French one.
  The room is 26 by 20 m with a 5.2 m ceiling, big enough for 16 cooks and a round of tag.
- **Eight stations are the clickable objects, with placeholder panels describing each station.**
  Linking them to the personal sections is deliberately left for later; `content.ts` keeps the `lore` sections for the portfolio page, and `stations` maps each station id to a panel.
- **The layout lives in `packages/shared/src/world.ts` as named fixtures.**
  Colliders, station positions, the minimap and the renderer all read from it.
  The floor is flat at y = 0 and the walls are a box clamp in the simulation, so there is no terrain function any more.
- **Counter colliders reach 2.4 m**, so nobody jumps onto a work surface and ends up with their head in a heat lamp.
  The hood is an overhang collider: jumping beside the piano bumps your head on it, as it would in a real kitchen.
- **The first player spawns in the aisle between the pass and the piano, facing the piano.**
  There is little room behind the spawn (the pass), so E2E tests walk sideways along the aisle.
- **Static geometry is merged per material** (`StaticBuilder`), so the whole kitchen is about a dozen draw calls.
  Small props use a lower-poly sphere.
- **The layout follows the kitchen at the French Laundry, by Daniel's request** (from its floor plan and a photo).
  The room shrank from 26 by 20 m to 16 by 13 m around the same 9.6 m cooking suite, so aisles are 1.2 to 2.5 m, like a real line.
  The pass sits between the suite and the dining room doors, two charcoal-topped islands (garde manger and pâtisserie) stand behind the suite, a long white counter with sinks runs under a strip of garden windows, the dish pit is by the dining room, and storage is on the end walls.
  The look follows the photo too: a white barrel vault with skylights, a stainless suite with a high shelf, a gridded and lit hood with three Michelin star plaques, white walls and a grey floor.
  The copper wall and the hanging pans are gone; only the pots a station uses remain.
- **"Every Second Counts", the navy nameplate from The Bear, hangs on the north wall over the windows** (white capitals, black rails).
  From the spawn the line of sight runs under the hood straight to it; on the hood itself the pass's heat lamps hid it.
- **The first player now spawns by the dining room doors, facing north over the pass.**
  E2E routes go round the west end of the pass to reach the line.
- **The kitchen is low-poly, by Daniel's request**: every material is flat-shaded and matte, round things have 6 to 12 sides, spheres are icospheres, and boxes get a single chamfer.
  Colors live on the geometry (vertex colors) instead of textures, including a terracotta and cream checker floor built from real tiles.
  The first pass used reflections and canvas textures; it read as unpolished realism rather than a style.
- **No reflections.** Metals have a little sheen from the lights but never mirror the room, so there is no environment map in any tier.
  Copper and brass do not receive shadows: under the hood they would turn maroon and olive.
- **Blender stays an option for hero props** (the Blender MCP can author glTF models), but the code-built low-poly look came first; it needs no model files or extra loading.
- **Hovering a station moves one small colored point light onto it** and fills its label with the station color.
  Halo sprites read as flat discs at this distance, and one moving light costs the same no matter how many stations there are.
- **Station labels declutter**: labels are placed nearest first, and a station label hides when it would overlap a nearer label that is showing.
  Name tags always show, and so does the hovered station's label.
  Station labels appear exactly as far away as stations can be clicked.
- **The ceiling, upper walls and ceiling fixtures do not cast shadows.**
  The key light sits above the ceiling; if the ceiling cast shadows, the whole room would be in shadow.
- **`PROTOCOL_VERSION` is 2**, because the shared simulation changed: an old island tab gets the reload prompt instead of predicting against the wrong world.
- **Spawn hints that cannot settle fall back to the spawn line.**
  Leaving a box from the inside never uses a face against a wall, and a hint wedged between two fixtures (the fridge and the garde manger stand 20 cm apart) gets a fresh spawn point.
- **The low quality tier has no accent lights and no hover light**, besides no shadows and a lower resolution.
- **Avatars wear a chef's toque** (one more instanced mesh).
- **The windows look out on Paris at dusk**, a canvas painting on a far plane, so the room has depth without rendering a city.

## The navy house style

- **The interface is French Laundry navy with ivory type**, like the kitchen's aprons and The Bear's navy: solid colors only, no gradients, glows or glass blur, hairline ivory borders, and 2 px corners.
- **Titles are EB Garamond, the rest Jost**, with small capitals letterspaced like a printed menu. Cormorant Garamond was tried first; its circumflex rendered badly, and a French kitchen's accents must be right.
- **Labels hide while a menu or panel is open, and on the landing screen**, so they never float over a dialog.

## Knives

- **Every room has knives, the public lobby included**, at Daniel's request; there are no game modes.
  Tag was removed for it.
- **The server decides every hit.**
  A throw is a bit on an input, not a message of its own, so the server launches the knife on the very step the thrower's client predicted, from the same eye, and the input's sequence number lets the thrower match its own knife to the server's.
  Letting a browser report its own hits would let anyone with devtools knock out the whole lobby.
- **Hits are checked against what the thrower saw.**
  Each input carries the server tick its sender was drawing other players at; the server keeps half a second of positions per player and tests each knife against them rewound by that much, capped at 400 ms.
  Without it, a moving cook that was clearly hit on screen would often be missed.
- **Flights are replayed, not streamed.**
  The server announces a throw once (origin and velocity) and its end once (where it stuck, or whom it hit, and how far into the flight); every client flies the same arc with the shared simulation and applies the end when its drawn knife gets that far.
  Other players' knives start 100 ms late, the same delay their avatars are drawn at, so a knife leaves the hand that threw it and arrives as the victim falls.
- **The cooldown is counted in inputs (14, about 0.7 s)**, not milliseconds, so catching up a burst of queued inputs cannot swallow a throw the client was allowed to make, and client and server always agree.
- **Knives stick into the room and the fixtures at their real height**, not the tall movement colliders over counters, which would leave knives hanging in the air.
  Small props (pots, plates) do not stop a knife; the vault's shape moved into the shared layout for this.
- **The newest 60 stuck knives per room are kept** and sent to newcomers in the welcome; older ones disappear.
- **A knocked-out cook lies still for 3 s, then respawns protected for 2 s.**
  While down, their inputs only let them fall; knives pass through them and through a protected cook.
- **Knives are drawn 1.5 times life size** so one stuck across the room still reads as a knife, and all of them (stuck and flying) are one instanced mesh.
  The knife in each cook's hand is one more, and the player's own, in front of the camera, is drawn over everything so it never clips into a wall; it leaves with each throw and slides back as the cooldown ends.
- **Version mismatches no longer lock visitors out.**
  A client and a room server from different deploys put the visitor in the kitchen in solo mode, and the client keeps retrying until the versions match.
- **The player's arm is a CS2-style view model**: a white chef's sleeve and a hand in the cook's color, holding the knife or empty, with look sway, a figure-eight walk bob and breathing.
  It is drawn in a second pass, in its own scene, after clearing depth, so it never clips into walls and its parts still sort against each other.
- **A throw releases at the end of the arm's snap, 0.12 s after the click**, as in CS2: the wind-up leads and the knife leaves the hand on screen, then blends onto its true path from the eye within 0.12 s, so aim stays on the crosshair.
  The animation's curves are tested to be continuous; the snap is fastest at the release.
- **Q switches between knife and bare hand**; a click with the bare hand punches.
  Holding the knife is a bit on every input and a flag in snapshots, so others see it, and the server refuses throws from a bare hand.
- **Knives fly at 26 m/s** (up from 18) for a flatter, sharper throw, and tumble faster. Protocol version 4.
- **Left click throws and E opens a station**, as in CS2 and Valorant, at Daniel's request: F threw before, and a click opened whatever station was under the crosshair.
  A click always throws, even at a station, so throwing never depends on where you aim; the prompt says "Press E to open".
  Without pointer lock, a click asks for it first, so the click that brings the mouse back does not throw; where the browser has never locked (it cannot, or always refuses), a click throws.
  A browser that has locked before and refuses for a moment (Chrome, just after Esc) does not turn that click into a throw.
  The throw starts on the button going down, not on release, and holding it keeps throwing as each knife is drawn, or punching with the bare hand.
- **I inspects the knife**, after CS2: the wrist rolls the knife to lie across the view, flat to the eye, turns it to show the other side, tips it up and spins it home. A bare hand has nothing to inspect.
  It is only on the player's screen (nothing on the wire), it waits for a throw or switch to finish, and a throw or Q cuts it short, blending out over 0.1 s instead of jumping.
- **The bare hand punches**, at Daniel's request, instead of a click drawing the knife: the open hand clenches and jabs toward the crosshair and back in 0.42 s, and holding the button keeps jabbing.
  It is only for looks, a punch hits nothing, but others see it: a punch is a key bit on an input, like a throw, and the server checks the hand is bare, the cook is standing and 0.4 s have passed, then tells everyone else, whose screens jab that cook's right fist as far in the past as they draw them. Protocol version 6.
- **The landing card is centered**, at Daniel's request, with the establishing shot aimed straight down the room behind it instead of beside it.
  Its controls line sits in the same navy pill as the in-world hint, since bare text was lost on the light floor.
- **The loadout sits over the minimap in the bottom right**, as wide as it, like Valorant's weapon list: the knife over the fist, the one in hand bright and marked on a rail, the other dim with a Q.
  After a throw the knife wipes back in from the handle as the next is drawn, so the cooldown reads at a glance.
  It has a navy backing like the minimap, because white icons alone vanish against the light kitchen.
- **Emotes are gone** (wave, dance and jump on 1 to 3), at Daniel's request; the earlier notes on them above are history.
  The messages left the protocol, so it is version 5, and the server no longer has an emote rate limit.
- **The controls hint teaches only moving and the hand**: WASD, Space, Shift, Q and I.
  The station prompt already says "Press E to open", and the pause menu still lists every control; the hint hides below 860 px, where it would meet the loadout and minimap.

### The look: evening service, after Ratatouille (2026-10-05)

- **The reference is Gusteau's kitchen in Ratatouille**, lit by Sharon Calahan, Pixar's director of photography for lighting: a classical French kitchen, a neutral white and black set so the food and faces carry the color, and lighting rules written down in interviews about the film.
  The rules used: the human world is warm and the world outside is cool; food looks best in slightly warm light; shadows go to "warm blacks", a very dark red-brown, never grey or black; reflections stay soft so steel reads as worked, not new; and the frame should look photographed, not filled in.
- **It is evening service, not daylight.** A daylit room of white walls under skylights is evenly lit by nature; a golden-hour sun through the windows was tried, and its patches read but stayed small.
  At the blue hour the windows and skylights go deep blue, and the kitchen is lit by its own lamps, in pools, which is both the film's warm/cool idea and the most striking contrast this room can have.
- **The light comes from the fixtures you can see**: soft-edged spots under the pass's heat lamps and under new brass pendants over the two islands, a warm area light under the hood, cove light from the strips where the vault meets the long walls, the burners' flicker, and a weak warm overhead light for grounding shadows. Fill is low and cool.
- **The environment map is for reflections only** (intensity 0.05, with steel, brass, copper, knives and glass turning theirs up): bright enough to light the painted surfaces, it lit them from every side and flattened the room more than any light.
- **High quality post-processing** (pmndrs `postprocessing` and N8AO): the scene into a 4x multisampled half-float buffer, N8AO ambient occlusion at half resolution tinted warm brown, the arm drawn over it, then one pass for bloom, AgX tone mapping, a grade (warm-black lift, warm highlights, a gentle S-curve), a vignette and faint grain.
  AgX over ACES (which washed the scene out) and Neutral (which clipped the brightest pools to cyan).
  Its code and the area lights' lookup tables load only on the high tier, during loading.
- **Beams under the lamps** are open cones drawn additively, thickest through the middle, all in one mesh; their shader clamps its inputs, since a single NaN, spread by the bloom, turned a whole frame black while tuning.
- **The low tier keeps the same evening** (blue windows and skylights, haze) with a brighter warm-neutral fill and no shadows, practical lights, environment or post-processing, so software renderers stay fast; a cool fill without warm lamps to balance it turned the room blue.
- **Performance** with 16 players and bots throwing: a steady 60 fps, about 2.1 ms of main-thread time per frame (the post-processing passes) and 72 draw calls.

### Input latency (2026-10-05)

- **The high tier governs its own cost.** On a retina screen it ran at 49 to 54 fps: 4x MSAA on a half-float buffer at 2880 by 1800, plus ambient occlusion, was more than the GPU's frame budget, and a GPU that falls behind makes the browser queue frames, each one more frame of lag on the mouse and keys.
  `world/governor.ts` watches frame intervals against the display's refresh (measured during loading, so 120 Hz screens are judged against 8.3 ms) and steps down when a window of frames, less its two slowest, averages 7% behind: resolution to 1.5x, then MSAA off, then 1.25x and 1x, then ambient occlusion off.
  A trimmed mean, not a median: missing one refresh in ten keeps the median on time while the frame rate drops.
  The level that holds is remembered per device; after 25 s of easy frames it tries one level up, and never again climbs to a level that has fallen behind this session.
- **Movement is drawn ahead, not behind.** The camera was blended from the previous tick to the current one, trailing the simulation by up to a tick, and a key press waited for the next 20 Hz tick: up to 48 ms before the view moved.
  Now it is blended from the current tick toward the next, simulated each frame with the keys held right then; the real tick takes that same deterministic step, so the two agree and reconciliation is unchanged. A key now shows on the next frame (16 ms at most).
  Superseded on 2026-10-07: see "Smooth movement" below.

### The view outside (2026-10-05)

- **The view through the north windows is a whole valley in real geometry, not a painted card.**
  The card (a 64 by 32 m plane, 20 m out) was flat, and from the ends of the window strip a glance along the wall ran past its edges into the white background.
  Now it is layers at their true distances, so each slides past the next as you walk: herb planters under the windows, a lane, a hedged kitchen garden with raised beds, a glasshouse lit from inside and string lights, vines up the slope, poplars along the lane, a farm and a village with their lamps lit, copses on the hills, firs below a ring of mountains, and a dome of sky with the afterglow low in the north-west, early stars and a new moon.
- **It closes in every direction a window or skylight can see.** The land is a fan half a circle wide around the windows, out to the far side of the mountains, and the sky is a whole sphere inside the camera's far plane.
  The dome is centered on the windows, like the land, and the mountains come back down before the land ends, so the skyline is always a ridge inside the sky, never a cut edge clipped by it.
  `outside.test.ts` raycasts from both ends and the middle of the windows through every part of the strip, and from all over the floor through the skylight openings, fails on any ray that misses, and checks that everything stays under the dome.
- **It is unlit, like a matte painting, and costs one draw call.** Each face's dusk light (a cool sky from above, a warm rim from the afterglow) and its haze are baked into vertex colors at startup, about 30 ms.
  The haze is blended in sRGB, as paint: blended in linear light, even a little of the bright horizon turned every dark green tan.
  Only the string lights' bulbs are on the kitchen's `light` layer, so the bloom catches them.
- **The skylights open onto the same sky**, as shallow wells through the vault with night glass and glazing bars, instead of strips of flat blue paint that read as daylight next to the dusk in the windows.
- **Window glass is a plain dark tint, unlit.** Smooth lit glass caught the kitchen's lamps as soft highlights, smeared as a brown streak across the view; an environment map at infinity cannot give a real reflection of the room anyway.
  Tumblers, the cloche, tubs and the fridge door were on the same night-glass material, so they read as smoky ghosts and drew their far sides over their near ones; they now have their own clear glass, front faces only.

### Closing a station panel (2026-10-06)

- **E closes a station's panel as well as opening it, and goes straight back to looking around.**
- **Esc also closes it, but leaves the mouse free** until the world is clicked; so does closing the pause menu with Esc.
  Taking pointer lock back during that Esc press, or even just after it, opened the pause menu on Chrome for macOS: the browser releases the lock on Esc, and losing the lock while playing means "pause".
  Waiting for Esc to come up before locking was tried first and was not enough, so the game no longer locks on Esc at all.

### Chef Skinner, the lobby's resident cook (2026-10-06)

- **A quiet portfolio should not feel empty, so the public lobby always has a cook in it**: Chef Skinner, the head chef who chases Linguini round the kitchen in Ratatouille.
  He walks the aisles, pauses at stations, and every 6 to 14 seconds throws a knife at someone.
- **He lives in the room server, as a player like any other** (`apps/server/src/chef.ts`). Each tick he queues one input, which the room simulates with the same movement, cooldown and knife physics as a visitor's, so every screen sees the same chef and nothing changed in the protocol or the client.
  He joins with the lobby's first visitor and leaves with its last; private rooms do not get one, and the landing page's "cooks in the kitchen" counts visitors only. `CHEF=off` turns him off.
- **He is fair, and leaves readers alone.** He walks a hand-made graph of the aisles rather than finding paths, which is enough in one room and never wedges him against a counter.
  Before throwing he stops and turns to face his target for 0.6 s, so the throw can be seen coming and dodged; he leads a moving target along the knife's real arc, with enough error that most throws at a cook on the move miss (about 10 throws and 4 or 5 knockouts in two minutes of pacing, in the tests).
  He ignores anyone in their first 8 seconds and anyone who has stood still for 3, which is what reading a station looks like, and he speaks at most every 25 seconds.

### Polish: the HUD, hits and the menu (2026-10-07)

- **The HUD talks like a game, not a dev build.** The connection reads Online with signal bars (the round trip in the tooltip), Connecting, or Solo; the old "Offline · solo mode · retrying in 9s" ticked down forever.
  Retries still happen, quietly. A "Click to look around" cue under the crosshair replaces a toast that repeated every time play resumed, and the same toast never shows twice at once.
  The loading screen names the place in the house type and says "Lighting the lamps", not "Warming up shaders".
- **Hits land.** A knife in you flares the screen edges red and snaps the view back with a short shake; a beat later (0.45 s, so the flash and the fall read first) the knockout card names the thrower in their color, over a drained, dimmed world, with a bar running down to the respawn, and waking up blinks.
  The thrower gets a hit marker and the victim's name under the crosshair. Everyone sees a kill feed under the player list; kill lines left the chat, which is for people.
  The red edge is a gradient, the one exception to the house style's solid colors: it is a screen effect, not interface.
- **The pause menu is a settings menu**, with Settings and Controls tabs: mouse sensitivity, field of view, invert vertical look, graphics (auto, high, low; the scene is built for one tier, so a change offers a reload), a frame rate readout, and reduce motion (no bob, shake or flash; on by default when the system asks).
  Settings persist; sensitivity keeps its old storage key so nobody loses theirs.
- **Not done**: reflections in the night windows (an environment map at infinity only smeared the lamps across them) and doors that open; both would need more than polish.

### The visitor's hours (2026-10-07)

- **The kitchen keeps the visitor's local time.** Nine hand-tuned looks sit at hours of the day (night, dawn, morning, midday, afternoon, the golden hour, the blue hour, late evening), each a sky gradient, a sun direction, stars, moon, the light on the land, whether the lamps outside are lit, and the light through the windows; any time between blends the two either side.
  The evening service look the room was lit for is the blue hour, unchanged.
- **The view is repainted every quarter hour, when the browser is idle**: painting takes a few tens of milliseconds, a hitch nobody should feel mid-throw.
- **By day the room is brighter but keeps its contrast.** The first try simply turned the window light and the sky fill up four times, and the white walls blew out; daylight comes in soft, mostly through the fill, while the kitchen's own lamps stay on as they would during service.
- **A red LED clock** shows the visitor's time with the seconds running (every second counts), over the dining room doors (see "The clock over the doors" below).
  It is drawn as seven-segment digits with the unlit segments faintly there, follows the visitor's 12 or 24 hour habit, and redraws only when the second changes.

### Smooth movement (2026-10-07)

- **The simulation runs at 60 ticks a second, and the camera is drawn between the last two ticks.**
  Drawing ahead toward a next tick predicted from the keys held right now made the view jump whenever a key changed mid-tick: the prediction changed course at once, by up to a few tenths of a meter at 20 Hz.
  Measured in a real browser while strafing back and forth, the camera moved at up to 14 m/s on about 30 frames of a 7 s run, at a 5 m/s walk, with a dozen frames snapping backwards.
  Easing the jump away instead (folding it into the fading correction offset) only turned a snap into a rubber band: after a key is released the view had already been drawn past where the cook stops, so it had to come back.
  At 60 Hz the blend from the previous tick to the current one shows only positions the simulation really reached, so nothing can pop or spring back, and it trails the simulation by at most 17 ms, about what drawing ahead at 20 Hz cost in waiting for a key.
  The same run now never exceeds walking speed and changes speed by at most one tick's acceleration per frame, apart from walking into a counter.
- **Snapshots stay at 20 a second; inputs go every tick.** The room simulates every tick but broadcasts every third, so the downstream bandwidth is unchanged; remote players were already drawn 100 ms behind from interpolated snapshots.
  Each client now sends 60 small input messages a second, so the per-connection message bucket allows 90 a second (120 in a burst); the input queue, credit and idle limits are set in seconds, not ticks.
- **One collision substep is enough at 60 Hz**: a sprint covers 0.14 m a tick, far less than a body's radius.

### The clock over the doors (2026-10-07)

- **The clock hangs over the dining room doors**, at Daniel's request: one face flat on the south wall in its black housing, centered on the doors a little above their steel frame and clear of the light line, facing into the kitchen.
  It replaced a clock hung under the front of the hood and a twin under the stars, and grew to 1.36 by 0.34 m so it reads from the windows across the room.
  From the islands and the windows it shows between the hood and the heat lamps over the pass; from the aisle between the piano and the pass the lamps' bar hides it, and no height under the light line would clear it.

### Stations serve the resume (2026-10-07)

- **Each station serves the part of Daniel's resume that suits its work**: le passe About me (with the five dishes), saucier Experience, rôtisseur Systems and ML projects, entremetier Products (Sync, Bridge, this kitchen), poissonnier Research, garde manger Skills, pâtisserie Interests, plonge Education and contact.
  The pass is the first thing a visitor sees, the saucier is the senior station, and the plonge is where every cook starts and sits by the dining room door.
- **A visitor can tell what a station holds before opening it**: the label shows the section in capitals under the station's French name in small italics, and the panel's kicker names the station ("Saucier · sauces") above the section title.
- **Roles and projects are written once in `content.ts`** and shared by the station panels and the portfolio page, so they cannot drift; a test checks that everything a station shows is also on the portfolio.
- **The UCLA research assistant role sits under Research, not Experience**, next to the Math Directed Reading Program, so Experience holds the industry internship.
- **Never the graduation date or the phone number**: a content test rejects graduation wording, any year after 2026, and phone-shaped numbers.
- **Panel items stack** (title, subtitle, then the date or place in small), since the panel is too narrow for a date beside a long title; the portfolio keeps them side by side except on phones.

### Turning Chef Skinner off (2026-10-07)

- **A visitor can switch Chef Skinner off for themselves**: "Chef Skinner throws knives at me" in Settings, on by default and saved with the other settings.
  It is sent in every hello and again whenever it changes, so it applies at once and survives reconnects and reloads.
- **Off means out of each other's game, both ways.** He never picks them, gives up mid wind-up when his target switches him off, and his knives and theirs pass through each other.
  One shared rule (`chefSpares`) decides it, on the server for hits and on every screen for the replay, checked each tick and frame, so a change mid-flight is handled too.
- **Everyone's choice is public**: player info carries each cook's prefs, and a change is announced, so every screen replays his knives as the server flies them.
  Telling only the server would have shown his knives vanishing into an opted-out cook on everyone else's screen.
- **He does not avoid opted-out cooks when he throws**: a knife at someone behind them simply passes through.
  Holding his throws was tried first; it let an opted-out cook shield others and was not needed once every screen knew.
- **The first time he knocks a visitor out, the knockout card says he can be turned off.**
- This changed the protocol (prefs in the hello and in player info, a prefs message each way, the resident flag), within version 7.

### Private parties (2026-10-07)

- **Private rooms are parties, managed in place from the pause menu's Party tab.** It is the menu's first tab: where you are, the invite link with Copy link (selecting the link where the clipboard is refused), and a code to start or join a party, or a way back to the lobby.
  Moving joins the next room in the background and closes the last one only once it is in, so a full, taken, empty or unreachable room leaves the player where they were, and nothing reloads.
- **Hello carries an optional intent, `start` or `join`.** Start is refused when the code is in use (`room_taken`), join when nobody is there (`no_room`); links and reconnects send none and join or make the room, and the lobby ignores it.
  Only the first hello sends it, so a reconnect is never turned away from its own party. This reveals nothing new: joining a code already shows who is there.
  It shipped within protocol version 7, with the 60 Hz simulation and the Chef switch.
- **Party codes are refused, not cleaned up, when typed with anything but letters, digits, dashes and spaces** (a leading `#` is allowed), so the code a visitor shares is the one they typed. Spaces become dashes, the most is 24 characters, and `lobby` is the lobby. The landing field uses the same rules.
- **Random codes look like `h7kq-m3xp`:** eight characters from 31 that cannot be mistaken for each other (no 0, 1, i, l or o), about 40 bits, drawn with `crypto.getRandomValues`.
- **The address bar follows the room** (`history.replaceState`, `?room=` set for a party and removed for the lobby, other parameters kept as written), so a reload or a copied address comes back to the same party.
- **A kill waiting for its knife to arrive on screen is forgotten when its room is closed or lost;** announced later, it knocked the player out where no respawn would come.

### The kitchen computer (2026-10-07)

- **A beige PC on a chef's desk in the south-west corner runs DOOM**, at Daniel's request, as a piece of systems work rather than an off-the-shelf port: a RISC-V (RV32IM) machine written in TypeScript, and DOOM's C source (`doomgeneric`) cross-compiled bare metal for it against a freestanding libc written for it.
  The corner was the only free one: by the dining room doors, across from the dish pit, at the end of the aisle the spawn looks along when turned round.
  The desk is a counter-height fixture, so it collides like the counters, and Chef Skinner's aisle graph clears it.
- **The machine is MMIO, not syscalls**: framebuffer and palette, keyboard queue, timer, console and a disk window the host fills with the WAD before boot, all in one ABI header mirrored in TypeScript and checked by a test.
- **A JIT, with the interpreter as the reference.** DOOM needs about a million guest instructions a frame; the interpreter manages 180 MIPS, the JIT (RISC-V regions compiled to JavaScript functions with `new Function`) about 3,200 in Chromium, so live play costs about 2% of a core. If a content security policy ever forbids `new Function`, the worker falls back to the interpreter.
  The JIT is checked against the interpreter on random programs, and both against the official riscv-tests.
- **It runs in a Web Worker and loads on first use**: the 485 kB ELF and the 4 MB shareware WAD are fetched only when a cook first sits down, and the machine pauses whenever nobody is at it or the tab is hidden.
- **Sitting down glides the view square onto the CRT**, filling most of the view, and every key goes to DOOM until Esc. Under pointer lock the browser takes Esc to release the mouse, so Esc has to mean stepping away; DOOM's menu, normally on Esc, moves to the backquote key, and the hint bar says so.
  Stepping away pauses the game with its last frame still on the screen, for the room to see.
- **The screen is 4:3**, as DOOM's 320x200 was meant to be shown, with nearest-neighbour sampling and faint scanlines, and the lit picture kept dim so the bloom barely catches it.
- **The monitor is solid to knives.** A knife thrown at the screen used to fly through the CRT into the wall behind it and poke its handle out through the glass, in the middle of the game.
- **The firmware is committed prebuilt**, since Vercel's build has no RISC-V toolchain; the build is reproducible with `brew install llvm lld` and `firmware/doom/build.sh`. The ELF is GPL like `doomgeneric`, and its source is in the public repository.
- **The controls are laid out over the screen whenever a cook sits down**, with a line on what the machine is; the first key or click puts them away and still reaches DOOM, leaving a one-line reminder along the bottom.
  Daniel got stuck between rooms with only a short hint bar to go on.
- **A mouse, because players reach for one.** With only the arrow keys to turn, modern players could not face a door squarely, and DOOM's use only reaches a line straight ahead within arm's length.
  The machine has a mouse register: horizontal motion counted on the host until the guest reads it, at most 2048 counts a read so DOOM's 16-bit turn never overflows, and the left button with clicks held until read.
  The mouse turns and fires but never walks (DOOM walked on vertical motion; the register has none, as DOS players got with `novert`), and no longer nudges the menu's sliders.
  A pixel of mouse motion turns the marine as far as it turns a cook in the kitchen, half a turn in about 1430 pixels, times the visitor's sensitivity; sitting down takes pointer lock, since E is a key press.
- **Space opens doors, as in DOOM**, and E and F too; Ctrl and the left button fire.

### The walk-in cooler, a secret room (2026-10-07)

- **The walk-in's door breaks after ten hits**, at Daniel's request: bare-hand punches within reach (1.3 m from the eye) and knives that stick in it.
  Behind it is a real cold room, empty for now for Daniel to fill: white insulated panels over aluminium plate, two vapour-proof lamps, the refrigeration unit high on the back wall and three empty wire shelving units.
- **The server decides every hit.** A punch is the existing key bit, checked from the eye after that input's step; a knife counts when the server's flight sticks it in the door.
  Each hit goes to everyone with where it landed, to the millimetre, and every screen derives the dent's shape from that place and its order, so all see the same door.
  Late arrivals get every dent in the welcome, and the door is whole again once the room empties, like the stuck knives.
- **The kitchen's walls became colliders, with a gap for the doorway.** The shut door is a collider in the gap; the open cooler adds its walls, a low ceiling, the lintel, its shelves and the open door.
  The simulation keeps a clamp only as a safety net around the kitchen and the cooler.
- **The opening never corrects anyone's prediction.** The burst tells each cook the first of their own inputs whose step sees the doorway open: 24 inputs (0.4 s) past the newest the server has from them.
  That is about when the swinging door clears the doorway, and later than any sane round trip, so the client always hears in time. Newcomers have it open from their first input.
  It is keyed to inputs, not server ticks, because a client cannot know at which tick its input will be applied.
- **Every hit shows**: smooth-shaded dents (flat facets read as noise) with knuckle pits for fists and small craters for knives, scuffs, the face bowing in, the handle drooping until it hangs, and the readout warming, flickering and dying at the seventh. The door shifts in its frame at the eighth and ninth, showing a sliver of cold light.
  Each hit rattles the door, the puncher's view jars as the fist lands, and the tenth bursts it open: it swings in, slams the wall and bounces, as cold mist rolls out. Knives stuck in the door go with it.
- **A dent shows when what made it arrives on screen**: a knife's with its drawn flight, another cook's punch with their fist, one's own no sooner than one's own fist.
- **The cold room's light is baked into its vertex colours and drawn unlit**, since the kitchen's lamps reach through walls; a point light, dark while the door is shut, lights what moves inside.
  The room and the mist are only drawn when some of the room can be seen: a shut door adds two draw calls, an open one up to four more.
- **Labels and station picking respect the wall** between the kitchen and the cooler, and the minimap rescales to show the cooler once it is open. The outside view can never show it (a test checks).
- This changed the protocol (a `cooler` message and the welcome's door) and the shared simulation, within version 7.

### Knives in the kitchen's structures (2026-10-07)

- **Knives stick where the kitchen is drawn, not into its fixtures' footprints**, at Daniel's request: they flew through the hood's body, the hanging lamps and the heat-lamp gantry, and hung in the air at the faces of open fixtures.
  Solids follow the drawn geometry: a counter's plinth, body and overhanging top; the hood's 4 cm skirt round its open, lit underside and its body up into the vault; the islands' open shelves and plate stacks; the shelving and pan rack; the doors, signs, clock and computer; the lamps and gantry; and the bigger station props.
- **Round things are a solid of their own**: stacked cone frustums on a vertical axis, squashed for oval pans, with an open hollow for lamp shades so a knife can fly up into a shade and stick inside it.
- **A knife sinks no deeper than what it hit allows**, so it never pokes out of a thin shelf or a shade's wall.
- **Windows and skylights take knives in their glass**: a knife flies into the window's reveal or up a skylight's well, and the glazing bars are solid. The vault is its flat facets, as drawn.
- **Small things let a knife through**: rods and rings, paper, things under 30 cm across, the food on the pass, and wire shelving; pendant cords are too thin to hold a knife. Pots, boards and the big centerpieces stop it.
- **A test throws knives at the drawn kitchen** (`knifeSolids.test.ts`, about 16,000 throws), so solids keep up with what is drawn: a knife may go at most 2 cm into anything sizable, never out of its far side, and must stick within 2 cm of something drawn.
  The shapes both sides need beyond plain boxes (lamp shades, skylights, stacked plates) live in the shared layout, and the client draws from them.
- **A grid over the floor plan** keeps the flight as cheap as it was with a dozen boxes, about 0.3 µs per knife per tick.
- Known gap: the walk-in door's dents (up to 7.5 cm) are not in the knife collision, so a knife in a dent sits at the flat door's plane.
- This changed the shared simulation within protocol version 7.

### Knife skins (2026-10-07)

- **A cook can carry one of twelve knives**, at Daniel's request, after the most popular CS2 knives: the kitchen's own chef's knife (the default), Karambit, Butterfly, M9 Bayonet, Bayonet, Flip, Huntsman, Falchion, Gut, Talon, Skeleton and Stiletto.
  Each is an original low-poly model built from primitives in the kitchen's flat-shaded style, recognizable by its silhouette (the karambit's claw and finger ring, the butterfly's split handles, the M9's saw-back and guard, the gut knife's hook).
- **Each knife comes in two or three finishes** after popular CS finishes (Doppler, Fade, Marble Fade, Tiger Tooth, Crimson Web, Case Hardened, Slaughter, Damascus for the chef's knife, and plain Vanilla), painted into vertex colors rather than per-skin materials, so knives still batch.
- **Every knife moves as its own**: a keyframed draw, idle and inspect per knife over the view model's pose, after CS2 (the butterfly flips open and through its routine, the karambit, talon and skeleton spin on their rings, the flip knife flips open, the bayonets roll and spin).
  One table holds every knife's moves (`world/knifeMoves.ts`), so the view model has no knife-specific code; throws and the bare-hand punch work with every knife.
- **The Knives tab in the pause menu** shows every knife, a live 3D look at the chosen one (its renderer exists only while the tab is open), its finishes and Equip; the equipped knife is kept with the settings and shows in the loadout.
- **Everyone sees each cook's knife**: in their hand, in flight, and stuck in the walls, for latecomers too. The look travels with the visitor's prefs (as the Chef Skinner switch does) and on each thrown and stuck knife.
  Unknown knives or finishes fall back to the chef's knife and the knife's default finish everywhere (`knifeLook`), so a newer client can never break an older screen. Knives are drawn in one instanced batch per look.
- This changed the protocol (optional look fields on prefs and knives), within version 7.

### Browser frame caps (2026-10-07)

- **A browser holding pages to 30 fps is judged as a 30 Hz display.** On a low battery Chrome's Energy Saver caps every page at 30 fps (an empty page too), and the governor snapped that measured cadence to 60 Hz, called every frame behind, and dropped the high tier to its cheapest level, then remembered it, without winning a single frame.
  `snapRefreshInterval` now knows 30 Hz, and 48 and 50 Hz, which a MacBook's display can be set to; nothing a page does lifts the cap itself.
- **The refresh only ever speeds up mid-session.** A window of frames with more than two quicker than the refresh shows a faster one (the laptop was plugged in, or the window moved to a faster screen), and the governor judges against that from then on.
  A slower cadence cannot be told from a GPU falling behind, so a cap that starts mid-session still steps quality down; the next load measures the cap and climbs back.

### The hand on screen (2026-10-08)

- **The hand is a skinned mesh, not boxes.** The fist was one rounded box with a box for a thumb, so a karambit spun round a block, its ring in the air beside it.
  Now it is a palm, four fingers of three phalanges and a thumb, faceted from convex hulls like the kitchen, in one skinned mesh of 20 bones: one draw call, one fewer than the box fist and its thumb.
- **Grips are solved from each knife's handle, not keyed.** `knifeHand` measures the handle where it is held (its side outline, so a long slab with no vertices in its middle still has a section) and wraps the fingers round it: each finger is a polygon round a circle, every phalanx touching the handle, its proximal phalanx the tangent from the knuckle and each joint turning by twice the angle of its equal tangents.
  The handle crosses the palm on a slant, from the heel of the hand to the root of the index finger, in the crease at the root of the fingers, as a real power grip holds it; so a knife leans out of the fist toward the fingers and the wrist bends little to aim it.
  A new knife needs no hand work: `viewmodelHand.test.ts` checks every knife's grip in the scene as drawn.
- **The ring and little fingers' metacarpals cup**, up to 13° and 24°, as a fist rounds on that side: without it the little finger, short and set back, could not reach a slanted handle.
  The palm's skin is shared between the wrist and the little finger's metacarpal there, so it cups with it.
- **The thumb is solved too**: a few thousand evaluations of the hand nudge its five angles until it lies over the index and middle fingers, out of them and out of the handle. It rests beside the index finger on the open hand the same way.
- **The karambit's ring threads the index finger.** The ring is in line with the handle, at its end, so the index finger cannot wrap the handle; it goes through the ring instead, bent at the knuckle to aim through it, and the other three wrap the handle.
  So the ring sets how far the index finger curls, and the hand turns about the handle whichever way bends the wrist least, of those that bring the ring within the finger's reach with its hole lined up with the finger. The knife spins round the finger, as in CS2.
  A first try turned the whole hand to put the ring on the finger where it wraps the handle, which bent the wrist 66 to 92°.
- **A talon or skeleton hangs by its ring from the index finger when spun**, turned so the ring's hole lines up with the finger, instead of from the middle of the fist.
- **The fingers let go of the handle while the knife spins out of it or hangs**, opening partway from their grip, and close on it again once it settles; a ring keeps the index finger round it.
- **The forearm turns halfway toward the hand**, as the elbow moves to suit a grip, leaving half the turn to the wrist: under 25° for every knife.

### Spammable inspect (2026-10-08)

- **Every press of I starts the inspect over**, as in CS2 and Valorant: a press mid-inspect plays it again from the start instead of being ignored.
  Holding I down does not keep restarting it, because the keyboard's repeats of a held key are not presses (`Input` ignores them).
- **I inspects out of the knife's draw the moment the knife is in the hand**, cutting the rest of the draw short, as CS2 lets you inspect during the deploy.
  A throw still waits until the knife is all the way up (0.34 s into a switch), so an inspect is no way to throw sooner.
  Only waiting for the knife to be up was tried first, and it dropped a press made just as a cook came into the world or drew the knife, which E2E caught.
  A press does nothing mid-throw, with the bare hand out, while the knife is on its way down for a switch, or out of view.
- **A cut keeps the arm's place and its speed.** Whatever is cut short (an inspect, the draw's flourish, the idle) carries on at the speed it was going, dying away, while what follows blends in with a smoothstep.
  The old blend froze the arm and eased out of it in 0.1 s, so cutting an inspect mid-spin moved the knife's tip up to 30 cm in a frame, 3 to 24 times as hard a jolt as the knife's own inspect ever gives it.
  Now a restart, even with I pressed every frame, jolts the knife at most about 1.6 times as hard as its inspect does (`viewmodel.test.ts` checks every knife).
- **An inspect blends in over 0.3 s, a throw or a switch over 0.1 s**, so a thrown knife still leaves the hand from where the throw puts it.
- **The knife's turns unwind the shorter way to where the inspect is headed once blended in**, not to its first frame, chosen once as the cut is made so the way round cannot flip partway.
  A karambit already hanging claw up over its ring is not spun a whole turn round to get back there.
- The inspect is not networked, and other cooks never saw it, so nothing changed for them.

### Switching back mid-switch (2026-10-08)

- **Pressing Q again before a switch is done picks up from the arm's height.** Every switch started from the top, so pressing Q twice within a tenth of a second snapped the arm back up from partway down, and a press while the bare hand was coming up snapped it.
  Now, on the way down, what is in hand comes back up from where it is; on the way up, it goes back down from there (`switchFrom` inverts the lowering and raising curves), and the cut's blend smooths what is left, the raise's overshoot above rest included.

### The interface revamp (2026-10-08)

- **The navy box is gone.**
  Every surface was the same navy rectangle with a hairline border, a tracked kicker, a serif title and pill tags, which read as generated.
  One system replaces it, written up with the approved mockups in `docs/ui-revamp.md`.
- **One theme, taken from games and 3D sites.**
  A first board also had kitchen paper, tape, enamel signs and printed menus, but drawing on all of them per surface would have looked cluttered; Daniel chose how Clair Obscur, Disco Elysium, Heaven's Vault and the Cartier site keep every screen the same.
- **No boxes: the dark is the container.**
  Reading surfaces sit on a side of the screen darkened like the blue hour (`--dark-from-left`, `--dark-from-right`) or on an even dim (`--dim`), and the house navy is that dark, never a fill.
- **Nothing behind or around words in the world.**
  Halos and ink pools read as blur, a crisp dark outline as too heavy, and a lighter rim was turned down too; labels, the prompt and the HUD hold up by weight, size, color and where they sit.
  The weakest spot left is a brass label over something pale (the beige house outside the windows, a white wall at noon).
- **Gabarito and Rubik.**
  The serifs tried (Bodoni Moda, EB Garamond) read as Times, and a marker hand (Kalam) as messy; Daniel picked Gabarito from six clean faces, with Rubik for text.
  The bundled latin subset has no arrows, so arrows are drawn.
  The kitchen's painted signs, the clock and the walk-in's readout letter in Rubik too, as they did in Jost.
- **Brass is the only accent, marked by a short rounded bar** under whatever is current, and keys are rings, a circle round one letter and a capsule round a word.
- **Plain words.**
  No slogans or flavor text: the landing lost "Come cook with me" and its tagline, the loading screen says what it is doing, and the pause menu keeps Resume and Leave world.
- **No French station names in the game.**
  Labels, panels and the prompt name the resume section only; `station` and `kicker` stay in `content.ts`.
- **The stylesheet is one file per surface** (`styles/app.css` imports them in cascade order), and the E2E suite and the screenshot script take other ports (`E2E_SERVER_PORT`, `E2E_CLIENT_PORT`, `WORLD_CLIENT_PORT`, `WORLD_SERVER_PORT`), so surfaces could be built in parallel worktrees and checked at once.
- **The landing is centered**: "Doyoon (Daniel) Kim", the bar, "CS + Statistics @ UChicago", the cook's name and "Enter the kitchen", with no key ring beside it since the button says it.
  A quiet row along the bottom has who is online, "Private party" (a disclosure that opens the code field, and opens by itself when an invite link carries a room) and the plain portfolio.
- **Behind the landing the camera walks a lap of the kitchen** (`game/landingCamera.ts`): two minutes round the suite and the pass at head height, looking ahead and a little in toward the suite, on a closed centripetal curve sampled into reused vectors.
  The swoop into the game follows that walk to the aisle by the dining room doors and glides along it to the cook, so it never crosses the hot line, the hood or the heat lamps; with motion reduced the old still shot holds.
  `landingCamera.test.ts` checks the whole loop and every swoop for clearance.
- **The loading screen is the landing's name**, with the landing's bar as a track filling with brass, so the bar is whole when the landing takes over.
- **The station panel is a column on the right**, the station in view beside it.
  Its leaders to the pins fade out close up rather than being capped: capping lowered the labels onto the lit counters, where brass vanished.
  A dish panel keeps its restaurant as a plain line under the bar, the five dishes on About read as menu rows, and phones and windows up to 480 px tall take the full width on the night.
  Focus starts in the scrolling text, so arrow keys and Page Down scroll at once.
- **The pause menu's tabs run down the left** and the arrow keys walk them either way; switches stay `role="switch"` but read as Off and On with the bar under the current word, and the knives are outlines and names instead of tiles.
  On a phone the tabs go across the top.
- **The HUD is plain words in the corners**; the prompt shows the E ring and the action while screen readers hear the whole sentence, and chat's system lines are full ivory so they hold over the light floor.
- **The minimap is a round night disc** with north tabbed on top, and the loadout stacks the knife over the fist with Q beside them and nothing behind; the icons held up against the bright walls without discs of their own.
- **The portfolio follows the same system**, imports `controls.css` rather than copying it, drops the kickers (they repeated the titles), gains the five dishes as its own section, lists its sections down the left on wide screens, and prints as a resume.
- **Picking stops at the walk-in's wall instead of being refused by it.**
  The wall test took the whole 10 m pick ray, so with the walk-in shut nothing could be picked while looking east, the plonge and the truffle croissant from the spawn among them.
  `coolerWallReach` now gives how far the ray gets before the wall stops it and picking looks only that far; `e2e/stations.spec.ts` reproduced the plonge failing first, and `cooler.test.ts` checks it agrees with the old segment test for any ray.

### A little spread on every throw (2026-10-09)

- **Every knife leaves the hand up to 1.5° off the crosshair, any way equally**, so knives thrown at one spot scatter round it instead of all going into one hole.
  Ten knives at the west wall from 8 m were tried in the kitchen at 1°, 1.5° and 2°: 1° still bunched them, and at the few meters most throws cross would stack them almost into one; 2° looked careless, up to 28 cm off.
  1.5° is the widest that costs a good aim nothing: a throw at the middle of a cook standing still hits them from anywhere along the kitchen's 16 m, where 2° misses about one in seven.
  At 8 m the knives land within 21 cm of the aim, half of them within 15 cm.
- **Uniform over the cone, not weighted toward the middle**, since weighting most throws onto the crosshair would bring back the knives stacked in one hole.
- **The spread is a hash of the thrower's id in the room and the sequence number of the input that threw it**, not `Math.random()` on either side.
  The thrower's screen draws its knife the moment the hand lets go, before the server hears of the throw, so the knife must come from what both already know: the knife's id comes from the server later, but the player's id (from the welcome) and the input's sequence number (sent with it) are known to both.
  Everyone else is sent the knife's velocity, as before, so nothing new goes over the wire.
  The hash (`hashRandom`, Murmur3's finalizer) is integer arithmetic only, which every engine does exactly alike; turning the throw by it uses the same trigonometry launching always did.
  A thrower could work out their next knife's spread in advance, but any way of letting a screen draw its own knife at once has to tell it, and anyone who would use that can already aim with devtools.
- **Chef Skinner's knives spread too**, since every knife in the room is thrown the same way, and his own wandering aim (up to 0.1 radians either way) is far wider anyway.
  His knockout rate against a pacing cook barely moved: 41% of his throws, against 42% without the spread, over 60 two-minute runs.
  `aimAt` still finds the throw that would hit if it flew straight from his eye; the spread and his aim error are how it misses.
- **Each screen keeps how far the server's word has moved a knife from where it flew it** (`knives.maxCorrection` in the debug state).
  An E2E test throws knives at one spot with a watcher in the room: they scatter within the spread, and each sticks where both screens flew it (a few micrometers off in the kitchen, against the 1 cm the test allows).
  With the thrower's screen seeding from the wrong id, the same test fails, its knives jumping up to 27 cm.
- This changed the shared simulation, so the protocol is version 8.

### A heat lamp over every plate (2026-10-09)

- **Each of the five dishes on the pass has its own heat lamp light.** Five lamps were drawn over the pass, but only three lit it, at the ends and the middle, so the beetroot and the ricotta toast sat grey between two amber pools.
  `lighting.test.ts` now checks every dish sits inside the bright core of a heat lamp's cone.
- **The cones narrowed from 0.5 to 0.35 radians**, the spread of the beams drawn under the lamps, so five lamps 1.5 m apart still make five pools on the pass, each round its plate, rather than one orange strip.
- Two more spot lights cost nothing measurable on the high tier: 60 fps with 16 players at device pixel ratio 1, governor level 0, the same 76 draw calls.

### Labels make way for the interface (2026-10-09)

- **No label in the world shows over the HUD**: station labels, their leaders and name tags all hide where they would cover the room's name, the players, the controls, the loadout and map, the chat or a toast.
  Words over words can be read as neither, and the house style puts nothing behind words to set them apart; looking along the pass, "Products" and "Experience" printed over the party's name, and "Research" over the player list.
- **Even the pinned label gives way.** The prompt under the crosshair is not kept clear, since it names the very station whose label is pinned above it.
- **The interface's boxes are measured only when they change size** (a `ResizeObserver`) or the window does, never in a frame; a part that is faded out or covered keeps its size, so each part says whether it shows, from its classes.

### The portfolio is the way in on a phone (2026-10-09)

- **On a touch-only device the landing's main action is "View the portfolio"**, in the title face with the brass bar, and "Enter the kitchen" steps down to a quiet button under the name, still there for a tablet with a keyboard.
  The landing already said the portfolio was the better way in on a phone, yet kept the kitchen, which has no touch controls, as the one main action; the quiet row's own portfolio link goes, as it would only repeat it.

### The governor counts what a screen can show (2026-10-09)

- **Levels that draw the same on a screen count as one.** On a 1x screen the first two levels draw alike, and the next three, since a resolution above the screen's own is capped to it; each of those steps still waited out a second and a half of falling behind, so ambient occlusion went about 6 s later than it needed to, all of it queued frames.
  The governor now steps between levels that look different on the screen at hand, always lands on the best of its kind, and never climbs back to one that draws like a level that fell behind.
- **The screen's ratio is followed, not taken once.** Browser zoom and moving the window to a screen of another ratio change it; the canvas used to keep the old one (blurry on a retina screen, or four times the pixels after leaving one, which stepped quality down and saved that). Now every resize applies it, a media query catches a move that does not resize the window, and the governor judges afresh there.
- **The string lights' shader compiles while loading**, by showing the bulbs for the compile: shown only toward dusk, a visitor arriving by day compiled it mid-play when they came on.

### The room server after review (2026-10-09)

- **A player's inputs must come numbered one after another, and a connection sending one that is not is ended** (close code 4006).
  The cooldowns, the walk-in's door and the knife's spread all go by sequence numbers, and the only rule had been that they rise: inputs 42 apart threw on every input, 60 knives a second, burst the door in ten ticks, and picked whatever spread the sender liked.
  The client numbers every tick it simulates and sends every one while online (in the menu, at the computer and knocked out too); catch-up ticks it drops are never numbered, and its count runs on through solo play, reconnects and room moves, so the first input on a connection may start anywhere.
  A WebSocket keeps order, so an honest client's numbers never skip or repeat; the one way it could lose an input was the server's own rate limit.
- **So the message limit now lets a stalled connection's burst through: 6 s of inputs at once** (360 messages, was 120), since a client waits up to 5 s on a silent server before reconnecting and sends everything it simulated meanwhile.
  Before, a stall of 3 s had an honest client kicked as a flooder; with numbered inputs, losing one would end the connection instead.
  It refills at 66 a second (was 90), just over the one input a tick and the ping a second a client sends, so a client sending inputs faster than there are ticks, to count its cooldowns down sooner, gains at most a tenth, and is cut off once its burst runs out.
- **The cooldowns stay counted in sequence numbers, not in inputs the server simulated.**
  Numbered one after another, the two differ only where the server drops inputs (its queue keeps the newest 0.4 s), which happens to honest clients after any network hiccup; counting simulated inputs would then refuse throws their screens had already drawn, to win back only the tenth the rate limit allows.
- **Skipping ahead can no longer pick a knife's spread.**
  A sender can still wait for an input whose spread they like, or aim against it, which the spread's own decision accepted: anyone who would can already aim with devtools.
  The first input of a connection can start anywhere, so rejoining picks one throw's spread, and rejoining starts the cooldowns afresh, as it always has; both cost a rejoin the whole room sees.
- **Behind CloudFront a client's address is the last entry of `X-Forwarded-For`, not the first.**
  CloudFront appends the address it got the request from to whatever the viewer sent (AWS, "Request and response behavior for custom origins", Client IP addresses), so the first entry is the visitor's to write, and the 20 connections per address capped nothing.
  Only CloudFront can reach the instance (its security group admits CloudFront's origin-facing prefix list alone) and nothing sits between them, so the last entry is always the address CloudFront saw.
  `CloudFront-Viewer-Address` was the alternative, but it depends on the origin request policy forwarding it (AllViewerExceptHostHeader is documented to include the viewer location headers, without listing them), its port has to be parsed off IPv6 addresses, and AWS does not say whether a viewer's own copy is replaced; the appended entry is documented plainly.
  Addresses are counted whole, so an IPv6 visitor could still spread sockets across their /64; capping per prefix is left until it is needed.
- **Every socket gets its error listener first**, before the origin check or the connection cap can turn it away.
  An oversized frame from a socket being turned away emitted an error nobody listened for, which Node throws, and the server process exited.
  Turned-away sockets are also terminated after a second, like dropped ones, so sockets refused for being too many cannot pile up in their close handshakes.
- **No catch-all for uncaught exceptions.**
  Node's documentation says a process is not safe to resume after one, and a message handled halfway can leave a ghost cook in a room that then never empties; systemd restarts the server in 2 s and the stack lands in the log, which is the better failure.
  The one known source, socket errors, is now always handled.
- **The first knife to reach a cook on a tick knocks them out, and any other flies on through them**, sticking wherever it ends.
  Both used to count as hits, the room dropped the second because its victim was already down, and that knife ended with no word: screens left it where their own flight had put it after 2 s, or nowhere.
  "First" is the first thrown, not the first to arrive within the 17 ms tick: it is deterministic, and the rewind to what each thrower saw blurs arrival that finely anyway.
- **On every screen, a knife the server says stuck flies through everyone**, since on the server it hit nobody.
  One that had already gone into a cook drawn in its way (the thrower's own screen gets there before the word) comes back out and flies on, instead of hanging inside them and then jumping to where it stuck.
  This also mends knives thrown through a cook still protected after respawning, which screens do not know about.
- **Changes of prefs have their own allowance, 8 at once and 2 a second**, and past it the newest waits its turn, replacing any before it.
  Each change goes to everyone in the room; dropping the extras would have been simpler, but the client does not send a change twice, so a visitor clicking quickly through the knives would have left the room showing one they had passed.
- **A hello's spawn hint is bounded to a million radians of turn**, like an input: a hint turned 1.7e308 reached the welcome and every snapshot as a yaw of -2e292.
  Its position needs no bound, being clamped to the play area, and the other open numbers (an input's view tick, ping ids) are clamped or only echoed back.
- **The lobby's room over HTTP is 15 visitors with Chef Skinner** (16 without him), since he takes one of its places; the landing reads only the count.
- None of this changes what an honest client sends or reads, so the protocol stays at version 8.

### A late heartbeat judges nobody (2026-10-09)

- **When the server's heartbeat comes late, the process itself was held up, and it only pings.** Node runs timers before it reads sockets, so after a pause of a few heartbeats (a long garbage collection, a busy host) the overdue beat found every pong that came meanwhile still unread, and dropped clients that had answered in time.
  `server.test.ts` holds the process for 700 ms while a pong is on its way, and the connection stays; one that stops answering is still dropped at the next beat on time.
- Found chasing an E2E run on a heavily loaded machine that went "Offline, playing solo" mid-test with nothing in the room's log; a stalled test process, which runs the room server in-process, fits it, though that one run could not be reproduced.

### A safer AWS stack and dev scripts that clean up (2026-10-09)

From a review of `infra/` and `scripts/`; nothing was deployed and no AWS call was made, so the stack was checked by local synth (dummy account, no credentials) and template tests only.

- **A server deploy waits for the new instance to answer its health check.**
  The instance has a CreationPolicy (one signal within 10 minutes; CloudFormation's documented default count is 1, so only the timeout is set).
  The boot script signals from its exit trap with its own exit code, and its last step waits up to 60 s for `/ws/health` on the instance, through the prefix CloudFront forwards.
  A failing step or a hang rolls the deploy back and the old instance keeps serving; before, a failed boot still ended `UPDATE_COMPLETE` with the old instance deleted.
  `cfn-signal` needs no credentials (CloudFormation checks the instance belongs to the stack); the helper scripts are documented as preinstalled on Amazon Linux AMIs, and the boot installs `aws-cfn-bootstrap` anyway.
  The shell flow was run locally against the real server bundle, with `cfn-signal` stubbed: success signals 0 only once `/ws/health` answers, a failing step signals 1 and names itself in the log, a server that never answers signals 124.
- **The boot log ships to CloudWatch before any step that can fail** (stream `<instance id>-boot`), and a failed boot waits 15 s before signalling.
  `cfn-signal --reason` only works for wait condition handles, so the stack event cannot say which step failed, and the rollback deletes the instance with its local log.
  Not verified on AWS: that the agent reads `cloud-init-output.log` from its start and ships it within those 15 s.
- **The instance and its Elastic IP depend on the public subnet's route to the internet gateway.**
  In a new stack the instance could otherwise boot before its route existed, which used to fail silently and would now fail the deploy.
  CloudFormation's EIP docs ask for a dependency on the gateway attachment; CDK's VPC-wide dependable is only the gateway, while the subnet's default route depends on the attachment.
- **The AMI is looked up once and kept in `infra/cdk.context.json`** (`cachedInContext`), which git now tracks; it was gitignored, so the availability zone and prefix list lookups lived only on Daniel's machine too.
  Before, CloudFormation resolved the AMI's SSM parameter on every deploy, so the first deploy after an Amazon Linux release replaced the instance and dropped every room, whatever the deploy was for.
  Considered: `resolveSsmParameterAtLaunch` (the newest AMI whenever an instance launches, never a replacement on its own), which patches the OS on every server deploy but keeps the AMI out of the template and `cdk diff`; and a hand-pinned AMI per region, which needs a lookup anyway.
  A recorded lookup keeps synth reproducible, as the CDK guidance asks, and moving on is a deliberate `cdk context --reset` (README).
  No entry is committed: a lookup needs credentials, so the first deploy writes it and Daniel commits the file.
  AL2023 locks its package repository to the AMI's release, so packages stay as they were until the AMI is refreshed; monthly is suggested.
- **CloudFront reaches the room server by an Elastic IP's public DNS name.**
  An instance's own public IP, and the name made from it, change on every stop and start, AWS maintenance included, which left the origin pointing nowhere until the next deploy.
  CloudFormation has no DNS name attribute for an Elastic IP, so it is built from `PublicIp`: `ec2-a-b-c-d.compute-1.amazonaws.com` in us-east-1, `ec2-a-b-c-d.<region>.compute.amazonaws.com` elsewhere.
  EC2's docs give the regional form and say a public DNS name resolves to the public address, Elastic IP included, from outside the VPC; the us-east-1 form comes from AWS's examples and from how the Terraform AWS provider derives `aws_eip.public_dns`, not from one stated rule, so `dig +short` the new `ServerOrigin` output once after the first deploy (it should print the Elastic IP).
  `AWS::EC2::EIP`'s `InstanceId` updates without replacement (it reassociates), so a server deploy moves the address only once the new instance has signalled, and the origin itself never changes.
  The instance still gets its own public IP at launch, for its boot downloads with no NAT gateway; EC2 releases it when the Elastic IP is associated, so the cost stays one public IPv4.
  Considered: CloudFront VPC origins, with no public address at all, which would need private egress (NAT or endpoints) for the boot.
- **The instance role reads only its bundle's object** (`s3:GetObject` on that key), instead of `Asset.grantRead`'s read and list on the whole CDK assets bucket.
  `aws s3 cp` makes a HeadObject first, which `s3:GetObject` covers; the default bootstrap key policy lets account principals decrypt through S3, so no KMS grant is needed (the old grant had none either).
- **The site goes up in two uploads.**
  `assets/`, where Vite puts everything it names by content (chunks, the computer's worker, the DOOM ELF and WAD, fonts, images), is cached `public, max-age=31536000, immutable` and never pruned, so a tab opened before a deploy can still lazy-load its own build instead of getting 403s.
  The pages and the favicon go up after it, with `no-cache` (CloudFront keeps them for the cache policy's 1 s minimum TTL; browsers revalidate each load), pruned except for `assets/*` (a BucketDeployment `exclude` also spares files from pruning), and with the `/*` invalidation.
  Old hashed files pile up, a few MB per build that changes them; removing the old single deployment deletes nothing, since `retainOnDelete` defaults to true.
- **The server log on the instance is bounded by size**: rotated daily, or once past 50 MB, keeping seven compressed copies.
  logrotate runs from `logrotate.timer` on AL2023, daily by default, so a drop-in makes it hourly for `maxsize` to act in time, and the boot enables the timer outright (an Amazon Linux maintainer says it is on in their AMIs; enabling it again is harmless).
  logrotate was not available here to dry-run the file; the directives are standard (`maxsize` since 3.8.1).
  The log group already kept two weeks; a flood still costs CloudWatch ingestion, and limiting what the server logs belongs in `apps/server`.
- **Bots never take a room's last seat.**
  `npm run bots -- --count 15` in the lobby made 16 with Chef Skinner, and the developer's own browser got `room_full`, while `/rooms/lobby` said 15 of 16.
  The bots read `/rooms/<code>` (lobby only) for a first count, then join one at a time and stop when the welcome's player list reaches one short of `MAX_PLAYERS_PER_ROOM`; a bot whose join fills the room leaves again, and a refused join gives one seat back.
  That holds whether `/rooms` counts Chef Skinner's seat in `max` or not; the room server's review now leaves it out (15 with him in), and the bots were checked against the version that counted it.
  They number their inputs one after another, as the server now requires: skipping ahead after a stall moves their clock, not their count.
  `--count` defaults to and stops at 15, one room's worth less a seat; the old cap of 64 predates the 16 player rooms and the 20 sockets per address.
- **Bots keep time in seconds at the 60 Hz tick.**
  Their odds were per tick from the 20 Hz days, so at 60 Hz they threw a knife about every 2 s (said 2 to 6), changed their minds every 0.3 to 1 s (said 1 to 3), and jumped and chatted three times as often.
  They also sent inputs off a timer that drifts (59.4 a second, measured from the server's acks); now each sends one input per tick of time gone by, 60.0 measured, and skips ahead rather than bursting after a stall.
- **The screenshots' own server has Chef Skinner in**, as the live site and `npm run dev` have him, so the lobby shots no longer depend on whether a dev server was already up (the committed ones were taken without him).
  He leaves newcomers alone for 8 s and anyone standing still, so he never knocks out the visitor in a shot.
  If the caged chef design is built, he will be in the walk-in in these shots too, as on the live site.
- **perf and screenshots stop what they start, however they end** (`scripts/processes.ts`).
  Vite and the bots were spawned before the `try`, so a failure (a port in use, a timeout, Chromium not launching) left them running, and the next run quietly reused a Vite built for another server; reproduced with a port that accepts and never answers, which left Vite on its port.
  Children now start inside the `try`, Vite directly rather than through npm, each in a process group of its own, and the whole groups are stopped on finishing, on an error, and on Ctrl+C (which no longer reaches them by itself, so the script passes it on and exits 130).

### The graphics upgrade: materials and reflections (2026-10-09)

- **The kitchen leaves the low-poly style, at Daniel's request.** The direction, the audit of what read as cheap and the before and after frames are in `docs/graphics-upgrade.md`; this records the calls made on the way.
- **Textures are painted on the GPU at load, from recipes in the code** (`world/surfaces/`): a fragment shader per surface draws its color, its height (made into a normal map) and its roughness into repeating, mipmapped, anisotropically filtered render targets.
  The spec forbids downloaded textures; a committed generator's images would have added megabytes to the repository and the download and could not be changed without rerunning it, while the GPU paints all of them in a few milliseconds behind the loading screen.
  Roughness rides in the normal map's alpha, so a surface costs two textures, or one when its paint is its color.
- **Texture coordinates are meters**, made by the builder as it merges each part: flat faces projected along their normal (with grain along a board's longer side), round parts unrolled to their circumference by the Kit's helpers.
  So a tile is the same size on every wall, and one material can carry any number of parts at their real scale.
- **Per-part finish**: the builder can write a roughness multiplier per vertex, so a polished marble slab and a honed charcoal top share the stone material, and glazed and crusty food share one too.
- **Wall tiles are large, 60 by 30 cm, stacked, with grout nearly their own color**, not subway tile: 15 by 7.5 cm in running bond read as a brick wall at the length of this room, and its grout grid fought everything in front of it.
  The walls should be calm, so the steel, the copper and the food carry the room; the French Laundry's renovated kitchen is plain white too.
- **Every kitchen material reflects a probe of the kitchen itself**: a cube map captured once the shaders have compiled (and again when the hour's light moves on), PMREM-filtered, and box-projected onto the room in the shader, so a lamp's reflection in the floor or the steel lands under the lamp.
  It replaces the small painted room the environment map used to be, and it is the scene's environment for the cooks and knives too.
- **The environment is still for reflections only**: the kitchen's materials take its specular reflection at full strength (Fresnel decides how much shows) and its diffuse light at 0.05, the old `environmentIntensity`.
- **Found on the way: three.js r186 ignores a material's `envMapIntensity` when it reflects `scene.environment`**; `WebGLRenderer.setProgram` puts `scene.environmentIntensity` in its place. The metals' 12 to 14 had never applied, so every metal reflected at 0.05, which is much of why the steel read as grey paint.
  The kitchen's materials and the walk-in's door now have the probe as their own `envMap`, which makes their intensity count.
- **Metals are fully metal on the high tier** (stainless, copper, brass), their colors what they reflect; the low tier has no probe to reflect, so its metals stay partly metal in their old deeper colors.
- **The low tier keeps plain paint**: the same smooth geometry and colors, no textures, no probe, so software renderers draw as cheaply as before.

### The graphics upgrade: real forms (2026-10-09)

- **Every edge seen up close is rounded and smooth-shaded** (three's `RoundedBoxGeometry`, two facets of arc under 12 mm and four above, with normals that roll round the edge), and round things have enough sides that a facet never strays from the circle by more than 0.6 mm on the high tier (2.5 mm on the low).
- **The knife solids did not move, so the protocol did not either.** Every drawn face stays within the 2 cm `knifeSolids.test.ts` allows: rounded edges sit inside the solids' boxes, door panels and trim stand at most 1.2 cm proud, and rods, knobs, wire and slats are thin enough to let a knife through as before.
  The vault is drawn as its true arc over the 12 facets that stay its solid; the two never part by more than 1.3 cm.
- **Lamp shades are drawn round their solid, not inside it**: a smooth shade's facets drawn inside the solid's circle met a slanting knife a few millimeters short of where it stuck. The outside is circumscribed and the inside drawn 4 mm in.
- **The cooking suite became a French range**: a thick top with a rounded edge, a brass band under it carrying rows of black knobs on brass bezels, brushed oven doors on brass rails, for the brass and steel of Gusteau's kitchen.
- **The window counter is white enamel under honed Carrara**, top, splash and sill, with its sinks set in steel rims; the islands stand on round tube legs with bullet feet, and storage is real wire shelving.
- **No anisotropic highlights on the steel.** Three's anisotropy takes its direction from the texture coordinates' screen derivatives, which on the narrow facets of a rounded edge come out degenerate and threw rows of white sparks along every door frame and counter edge; the brushing is in the normal and roughness maps instead.
- **The hood's baffle filters are a texture, not slats**: 600 slats a few millimeters across glittered at any distance; one painted filter per panel is crisp up close and quiet far away. Wire shelving is dulled for the same reason.
- **Plates under others in a stack are turned as their foot and rim only**, since nothing else of them shows; it halved the kitchen's triangles.
