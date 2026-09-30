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
