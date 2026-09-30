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
- **Fonts are system stacks** (`ui-rounded` for headings), so nothing is downloaded.
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
