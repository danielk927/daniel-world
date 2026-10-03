# Daniel's World

A personal website that is a small multiplayer 3D world.
Visitors walk a low-poly three-star kitchen, laid out after the French Laundry, in first person, click its stations to learn about Daniel, and see everyone else who is visiting as a cook in a toque with a name tag.
There is also a plain [portfolio page](apps/client/portfolio.html) with the same content, for phones, browsers without WebGL, and anyone in a hurry.

**Live:** https://d1ivv0s5bbzyx0.cloudfront.net (AWS: CloudFront, S3, EC2) and https://daniel-world-nine.vercel.app (Vercel front end on the same AWS room server).

Everything also runs locally: no accounts, no API keys, no paid services, no downloaded models or textures.

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
| Click     | Open a station                        |
| Enter     | Chat (120 characters, plain text)     |
| 1 / 2 / 3 | Wave / dance / jump for joy           |
| Esc       | Menu                                  |

Leave the room code empty to join the public `lobby`, or type any code to get a private kitchen.
Private rooms have a "Copy invite link" button in the menu, which links to `/?room=<code>`.

Private rooms can also play **tag**: open the menu and press "Play tag".
Whoever is it (marked with a red diamond and an IT badge) chases everyone else for 90 seconds.
You score a point for every second you are not it, and the highest score wins.

## Editing the content

All personal content lives in [`apps/client/src/content.ts`](apps/client/src/content.ts).
Every placeholder is marked `TODO(daniel)`; search for that tag and replace each one.
The portfolio page renders the `lore` sections, and each of the kitchen's eight stations shows its entry in `stations`.
Point a station at one of your sections (for example `saucier: lore[0]!`) to show it in the kitchen.

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

- The static kitchen is merged into one mesh per material, about a dozen draw calls for every pot, knob and tile.
- Avatars are instanced, and ambient motion (gas flames, steam) runs in shaders.
- The look is low-poly: flat-shaded facets and plain colors, with no textures to sample and no reflections to compute.
- Name tags are DOM elements rather than extra draw calls.
- Software renderers (no GPU) automatically get a lighter quality tier without shadows or accent lights.
  `?quality=high` or `?quality=low` overrides the choice.

![Two visitors on the live AWS deployment](docs/screenshots/live-aws.png)

Measured with `node scripts/perf.ts` on an Apple M5 laptop with 16 players in one room: a steady 60 fps, about 1.1 ms of main-thread time per frame, 34 draw calls and 66k triangles.
The earlier island measured 1.4 ms and 62 draw calls in a back-to-back run on the same machine.

Judgment calls made while building are recorded in [DECISIONS.md](DECISIONS.md).

## Deployment

The site has two parts with different hosting needs.
The client is static files.
The room server is a long-running process that holds WebSocket connections and the in-memory rooms, so it cannot run on serverless functions (Vercel, Lambda).

### AWS (primary): one command with the CDK

`infra/` defines the whole production stack with the AWS CDK in TypeScript:

```text
visitor ──HTTPS──▶ CloudFront ─┬─ /*    ──▶ S3 bucket (private, Origin Access Control)
                               └─ /ws*  ──▶ EC2 t4g.micro room server (Graviton, port 3001)
```

- **CloudFront** is the only public entry point.
  It serves the site and proxies WebSocket traffic on the same domain, so the page connects to `wss://<same host>/ws` with CloudFront's TLS certificate and no custom domain is required.
- **S3** holds the built client; the bucket is private, encrypted, and readable only by the distribution.
  Every deploy uploads the new build and invalidates the cache.
- **EC2** runs the server bundle under systemd as an unprivileged user, on a pinned and checksum-verified Node.js.
  Its security group accepts only CloudFront's origin-facing IP ranges on port 3001; there is no SSH, and shell access goes through **Systems Manager Session Manager**.
  A new server build replaces the instance (immutable deploys).
- **CloudWatch** receives the server logs (two-week retention) and two alarms self-heal the instance: host failure triggers EC2 auto-recovery, an unresponsive instance is rebooted.
- **IAM** is least privilege: the instance role has Session Manager access, read access to its own code bundle, and write access to its own log group.
- No NAT gateway and a single public subnet keep the cost to roughly the instance and its public IP (about $10/month, less on the AWS free tier).

First time only:

```bash
aws login                                         # or aws configure / aws sso login
npx cdk bootstrap -a "node infra/bin/world.ts"    # prepares the account for CDK deploys
```

Then deploy (and redeploy after changes) with:

```bash
npm run deploy:aws
```

The command builds the client (pointed at `/ws`) and the single-file server bundle, then runs `cdk deploy`.
It prints `SiteUrl` (the site), `ServerUrl` (for a client hosted elsewhere), `ShellCommand` (Session Manager) and `ServerLogGroup`.
`npm run diff -w @world/infra` previews changes; `npm run destroy -w @world/infra` removes everything.
Rooms live in one process's memory, so keep exactly one instance.

### Vercel (optional second front end)

`vercel.json` builds the static client for Vercel.
To give it multiplayer, set the project's `VITE_SERVER_URL` environment variable to the stack's `ServerUrl` output (for example `wss://d1234abcd.cloudfront.net/ws`) and redeploy.

### Other hosts

The server is one file with no runtime dependencies besides Node.js 22+:

```bash
npm ci && npm run build -w @world/server
PORT=8080 TRUST_PROXY=1 node apps/server/dist/index.js
```

Environment variables (see [`apps/server/.env.example`](apps/server/.env.example)): `PORT`, `ALLOWED_ORIGINS` (comma-separated page origins; unset allows any), `TRUST_PROXY=1` behind a proxy, and `BASE_PATH` when a CDN forwards a path prefix such as `/ws`.
Railway or Render work with build command `npm ci && npm run build -w @world/server`, start command `node apps/server/dist/index.js`, and health check `/health`.
Build the client with `VITE_SERVER_URL` set to the server's `wss://` URL, or to a path like `/ws` when the same domain proxies to the server.

## Testing

- Unit and integration tests (Vitest) cover the simulation, protocol validation, rate limiting, rooms, the WebSocket server, prediction and interpolation.
- End-to-end tests (Playwright, Chromium with SwiftShader software WebGL) open several browser contexts and assert on a read-only `window.__world` debug object that exists only in dev and test builds.
  They cover lobby presence, movement replication, chat, private room isolation, leaving, the info panel, and offline play with automatic reconnection.
