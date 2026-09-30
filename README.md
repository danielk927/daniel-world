# Daniel's World

A personal website that is a small multiplayer 3D world.
Visitors walk a floating island at golden hour in first person, click glowing objects to learn about Daniel, and see everyone else who is visiting as a moving avatar with a name tag.
There is also a plain [portfolio page](apps/client/portfolio.html) with the same content, for phones, browsers without WebGL, and anyone in a hurry.

Everything runs locally: no accounts, no API keys, no paid services, no downloaded models or textures.

![Landing screen](docs/screenshots/landing.png)

| World, with other visitors                  | Info panel                                          |
| ------------------------------------------- | --------------------------------------------------- |
| ![In the world](docs/screenshots/world.png) | ![Info panel](docs/screenshots/info-panel.png)      |
| ![Pause menu](docs/screenshots/pause.png)   | ![Portfolio](docs/screenshots/mobile-portfolio.png) |

## Quick start

Requires Node.js 22.18 or newer (the server runs TypeScript natively in development).

```bash
npm install
npm run dev
```

Open http://localhost:5173.
The room server listens on :3001.
Open a second browser window to see yourself from the outside.

## Controls

| Key       | Action                                |
| --------- | ------------------------------------- |
| W A S D   | Move (arrow keys work too)            |
| Mouse     | Look around (click the world to lock) |
| Space     | Jump                                  |
| Shift     | Sprint                                |
| Click     | Open a glowing object                 |
| Enter     | Chat (120 characters, plain text)     |
| 1 / 2 / 3 | Wave / dance / jump for joy           |
| Esc       | Menu                                  |

Leave the room code empty to join the public `lobby`, or type any code to get a private island.
Private rooms have a "Copy invite link" button in the menu, which links to `/?room=<code>`.

Private rooms can also play **tag**: open the menu and press "Play tag".
Whoever is it (marked with a red diamond and an IT badge) chases everyone else for 90 seconds.
You score a point for every second you are not it, and the highest score wins.

## Editing the content

All personal content lives in [`apps/client/src/content.ts`](apps/client/src/content.ts).
Every placeholder is marked `TODO(daniel)`; search for that tag and replace each one.
The 3D world and the portfolio page both render from this file, so they never drift apart.
The island has exactly eight pedestals, one per entry.

## Scripts

| Command                       | What it does                                                             |
| ----------------------------- | ------------------------------------------------------------------------ |
| `npm run dev`                 | Client (Vite, :5173) and server (:3001) with reload                      |
| `npm run build`               | Server bundle in `apps/server/dist`, static site in `apps/client/dist`   |
| `npm start`                   | Run the built server                                                     |
| `npm run lint`                | ESLint (type-aware) and Prettier check                                   |
| `npm run typecheck`           | TypeScript in every workspace                                            |
| `npm test`                    | Vitest unit and integration tests                                        |
| `npm run e2e`                 | Playwright end-to-end tests (run `npx playwright install chromium` once) |
| `npm run bots -- --count 15`  | Simulated players wandering the lobby                                    |
| `node scripts/screenshots.ts` | Regenerate `docs/screenshots/`                                           |
| `node scripts/perf.ts`        | 16-player performance check (needs the dev client running)               |

## How it works

The repository is an npm workspaces monorepo.

- `packages/shared` holds everything client and server must agree on: the zod message protocol, constants, the world layout and its colliders, and a deterministic movement simulation.
- `apps/server` is a Node WebSocket server (`ws`).
  Rooms live in memory, hold up to 16 players, and disappear when empty.
- `apps/client` is Vite, TypeScript and Three.js, with plain DOM and CSS for the interface.

Networking follows the usual pattern for fast-paced games:

- Clients send one input per tick (20 Hz) and predict their own movement with the shared simulation, so movement feels instant.
- The server runs the same simulation at 20 ticks per second and broadcasts snapshots.
  When a snapshot arrives, the client rewinds to the server's state and replays inputs the server has not seen yet.
  Because the simulation is deterministic and quantized, this lands exactly where prediction was.
- Other players are drawn about 100 ms in the past, interpolated between snapshots.
- Every inbound message is validated with the shared schemas.
  The server rate limits each connection, disconnects floods, drops dead connections with a heartbeat, caps connections per IP, and only simulates one input per tick per player, so speed hacks do not work.
- If the server is unreachable, the world keeps working in single-player mode and reconnects in the background.

Rendering is built for a smooth 60 fps with a full room:

- Avatars, trees, rocks, grass and the rim wall are instanced.
- Ambient motion (wind, clouds, water, drifting light motes) runs in shaders.
- Name tags are DOM elements rather than extra draw calls.
- Software renderers (no GPU) automatically get a lighter quality tier without shadows.
  `?quality=high` or `?quality=low` overrides the choice.

Measured with `node scripts/perf.ts` on an Apple M5 laptop with 16 players in one room: a steady 60 fps, about 1 ms of main-thread time per frame, and 61 draw calls.

Judgment calls made while building are recorded in [DECISIONS.md](DECISIONS.md).

## Deployment

Nothing here has been deployed.
The client is a static site and the server is a single long-running Node process, so they can be hosted separately.

### Server (Fly.io, Railway, Render, or any VPS)

The server needs a host that keeps WebSocket connections open.
Build it once and run the bundle; it only needs the `ws` package at runtime.

```bash
npm ci
npm run build -w @world/server
PORT=8080 TRUST_PROXY=1 ALLOWED_ORIGINS=https://your-site.example node apps/server/dist/index.js
```

Environment variables (see [`apps/server/.env.example`](apps/server/.env.example)):

- `PORT`: listen port (default 3001).
- `ALLOWED_ORIGINS`: comma-separated page origins allowed to connect; unset allows any.
- `TRUST_PROXY=1`: take the client IP from `x-forwarded-for`, needed behind a platform proxy.

On **Railway** or **Render**, point a Node service at the repository with build command `npm ci && npm run build -w @world/server`, start command `node apps/server/dist/index.js`, and health check path `/health`.

On **Fly.io**, a Dockerfile along these lines works (not tested here, Docker was not available):

```dockerfile
FROM node:24-slim AS build
WORKDIR /app
COPY . .
RUN npm ci && npm run build -w @world/server

FROM node:24-slim
WORKDIR /app
COPY --from=build /app/apps/server/dist ./dist
RUN npm install ws@8
ENV PORT=8080 TRUST_PROXY=1
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

Then `fly launch --no-deploy`, set `ALLOWED_ORIGINS` with `fly secrets set`, keep one machine running (rooms live in memory, so do not scale to more than one instance), and `fly deploy`.

### Client (GitHub Pages, Vercel, Netlify, Cloudflare Pages)

Build with the server's public WebSocket URL baked in:

```bash
VITE_SERVER_URL=wss://your-server.example npm run build -w @world/client
```

Upload `apps/client/dist`.
On **Vercel** or **Netlify**, use that as the build command with output directory `apps/client/dist` and set `VITE_SERVER_URL` in the project settings.
On **GitHub Pages**, publish `apps/client/dist` from a workflow; if the site lives under a sub-path, also set Vite's `base` option in `apps/client/vite.config.ts`.

## Testing

- Unit and integration tests (Vitest) cover the simulation, protocol validation, rate limiting, rooms, the WebSocket server, prediction and interpolation.
- End-to-end tests (Playwright, Chromium with SwiftShader software WebGL) open several browser contexts and assert on a read-only `window.__world` debug object that exists only in dev and test builds.
  They cover lobby presence, movement replication, chat, private room isolation, leaving, the info panel, and offline play with automatic reconnection.
