# 3D multiplayer personal world

This spec is final.
Do not brainstorm or ask clarifying questions.
When something is ambiguous, pick the option that best serves quality and simplicity, and record it in `DECISIONS.md`.

## Goal

A personal website for Daniel Kim that is a small 3D world explored in first person, like joining a game lobby.
Visitors walk around, click floating objects to learn about Daniel, and see every other visitor in the same world as a moving avatar with a name tag, in real time.
It must run fully locally with no accounts, API keys, or paid services.

Inspiration: world.kathirm.com (github.com/kathirmeyyappan/world).
Build an original implementation. Do not copy code, assets, or content from that project.

## Non-goals (for this run)

- No deployment, no DNS, no pushing to any remote.
- No accounts or authentication. No database; room state lives in server memory.
- No real personal content. Use clearly marked placeholders that are easy to replace.
- No external 3D model or texture downloads; build the world and avatars from primitives, procedural materials, and shaders.

## Stack

- npm workspaces monorepo (do not require pnpm or yarn).
- `apps/client`: Vite + TypeScript (strict) + Three.js. Plain DOM/CSS for UI overlays (no React needed).
- `apps/server`: Node + TypeScript WebSocket room server using `ws`.
- `packages/shared`: message protocol with `zod` schemas, constants (tick rate, speeds, world bounds), and the movement simulation used by both client and server.
- Tests: Vitest for unit/integration, Playwright (Chromium) for E2E.
- ESLint + Prettier.
- One root command starts everything: `npm run dev` (client on :5173, server on :3001).

## Experience

1. **Landing screen**: site title, short tagline, name input (prefilled with a random adjective + animal, saved in `localStorage`), room code field (empty = public `lobby`), "Enter world" button, live player count for the lobby, and a "Skip to portfolio" link.
2. **World**: a stylized, good-looking environment (for example a floating island or plaza at golden hour) with lighting, fog, sky, and some ambient motion. Clear boundaries so players cannot fall off forever.
3. **Controls**: pointer-lock first-person, WASD + mouse look, Space to jump, Shift to sprint, collision with ground and major objects. Esc releases the mouse and opens a pause menu.
4. **Lore objects**: 6 to 8 floating, slowly rotating objects (About, Projects, Experience, Skills, Contact, and a couple of fun ones). Looking at one highlights it; clicking opens an info panel. All content comes from `apps/client/src/content.ts`, with every placeholder marked `TODO(daniel)`.
5. **Multiplayer**:
   - Everyone in the same room sees each other as simple stylized avatars (built from primitives, colored per player) with floating name tags.
   - Remote avatars move smoothly (snapshot interpolation) and animate (bob while walking, jump).
   - HUD: room code, player list and count, connection status.
   - Text chat (Enter to open, 120 char max, plain text only) and a few emotes (wave, dance, jump) on number keys.
   - Rooms: default public `lobby`, plus private rooms by code. Max 16 players per room.
6. **Portfolio fallback**: `/portfolio.html`, a clean static page rendering the same `content.ts` data, for mobile, no-WebGL, and anyone who wants the plain version. Detect no-WebGL and touch devices and suggest it.
7. **Offline mode**: if the server is unreachable, the world still works in single player with a small notice, and retries in the background.

## Networking

- Clients send inputs (movement keys, look direction, jump) at ~20 Hz; the server runs the shared simulation at 20 ticks per second and broadcasts snapshots.
- The local player uses client-side prediction with server reconciliation, so movement feels instant.
- Remote players render ~100 ms in the past with interpolation.
- Validate every inbound message with the shared zod schemas and drop invalid ones. Clamp speed and position on the server.
- Per-connection rate limiting; disconnect flooders. Heartbeat to drop dead connections. Broadcast join and leave.
- Server URL comes from `VITE_SERVER_URL` with a localhost default.
- In dev and test builds only, expose `window.__world` with read-only debug state (local player position, list of remote players and positions, connection status) so E2E tests can assert on state instead of pixels.

## Quality bar

- Looks and feels like a polished indie game, not a tech demo.
- Holds 60 fps on a normal laptop with 16 players: share geometries and materials, keep draw calls low, no per-frame allocations in hot paths.
- Loading screen while assets and shaders initialize.
- UI overlays are keyboard accessible with good contrast.

## Milestones

Work through these in order.
After each one: run all checks, fix failures, commit locally with a clear message, and update `PROGRESS.md`.

- **M0 Scaffold**: monorepo, three workspaces, scripts (`dev`, `build`, `lint`, `typecheck`, `test`, `e2e`), `.gitignore`, and a project `CLAUDE.md` with commands, map, conventions, and how to verify.
- **M1 Single-player world**: landing screen, environment, controls, collisions, lore objects with info panels, content file, pause menu, portfolio fallback page.
- **M2 Room server**: rooms, protocol, shared simulation, tick loop, validation, rate limiting, heartbeat, with unit tests (including simulation determinism between client and server).
- **M3 Multiplayer client**: connect and join, prediction and reconciliation, remote avatars with interpolation and name tags, HUD, chat, emotes, reconnect with backoff, offline mode.
- **M4 E2E**: Playwright tests (Chromium with software WebGL, for example `--use-angle=swiftshader`) that open two browser contexts and verify through `window.__world`: both join `lobby` and see 2 players, moving player A changes A's position as seen by B, chat from A arrives at B, a private room code isolates players, closing A drops B's count to 1, and with the server stopped the world still loads in single-player mode.
- **M5 Polish**: visual QA with Playwright screenshots of landing, world, info panel, and portfolio page saved to `docs/screenshots/`; fix anything that looks off; performance check with 16 simulated bot clients; remove dead code; write `README.md` with a deployment section (for example client on GitHub Pages or Vercel, server on Fly.io or Railway) without actually deploying.
- **M6 Stretch, only if everything above is green**: a lightweight game mode in private rooms, such as tag or a foam-blaster round, with a simple scoreboard.

## Verification (definition of done)

All of these pass from a clean checkout:

```bash
npm install
npm run lint
npm run typecheck
npm test
npx playwright install chromium
npm run e2e
npm run build
```

## Working rules for this unattended run

- The user is away. Never stop to ask questions; decide, log it in `DECISIONS.md`, and continue.
- Keep `PROGRESS.md` current (checklist of milestones, what is done, what is next) so a fresh session could resume from it if context runs out.
- Use subagents for large exploration or for an independent review after each milestone.
- Commit locally after every milestone. Do not push, do not force anything, do not `rm -rf` outside the project, do not use `git reset --hard`.
- If a step fails 3 times in a row, write the blocker in `PROGRESS.md`, work around it or skip to the next milestone, and come back later.
- When everything is done, write a final summary at the top of `PROGRESS.md`: what was built, how to run it, known issues, and what needs Daniel's input (real content, deploy accounts).
