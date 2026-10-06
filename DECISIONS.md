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
