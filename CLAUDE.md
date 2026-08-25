# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

NESTrisChamps is a browser-based capture, broadcast, and rendering system for NES classic Tetris (and Das Trainer). A capture page ("producer") OCRs game state from video and streams it over WebSocket to a Node/Express server, which rebroadcasts it to one or more "renderer" pages (HTML+CSS+JS layouts meant to be used as OBS Browser Sources). Multiple players' streams can be combined into a live head-to-head competition UI with score differentials, tetris rate, pace, etc.

It's a plain ESM Node.js app (`"type": "module"` in package.json) with server-rendered EJS views for a few admin/settings pages, and hand-written vanilla JS for the actual capture/render frontends under `public/`. No frontend build step/bundler is used.

## Commands

- `npm start` — runs the server (`node -r dotenv/config server.js`), reads config from `.env`
- `npm test` — runs Jest (`tests/*.test.js`), using native ESM (no transpilation: `transform: {}` in jest.config.js)
  - Run a single test file: `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/ScoreService.test.js`
  - Run by name: add `-t "pattern"`
- `npm run lint` — runs both `lint-be` (ESLint on everything except `public/`) and `lint-fe` (ESLint on `public/`); backend and frontend have different global/env configs in `eslint.config.mjs`
- Prettier runs automatically on staged files via a Husky `pre-commit` hook (`pretty-quick --staged`) — formatting (tabs, single quotes, semicolons) is enforced at commit time, not just CI
- `npm run session` — utility script to set local session ids for dev/testing
- Local Postgres DB: apply `setup/db.sql`, plus any dated migration files in `setup/` in chronological order (e.g. `20250630.sql`) for schema changes not yet folded into `db.sql`
- Docker: `docker/build.sh` then `docker/run.sh` (docker-compose) spins up the app + a local Postgres container; see `docker/docker-compose.yml` for expected env vars

Required `.env` vars for local dev: `DATABASE_URL` (Postgres connection URI) and optionally `FF_SAVE_GAME_FRAMES=1` (persists captured game frames to `./games/` for replay/analysis). Full config schema (all env vars, including Twitch/Discord/Google OAuth, S3 game-frame storage, TURN server) lives in `modules/config.js` (uses `convict`) — that file is the source of truth for every env var the app reads.

## Architecture

### Two runtime halves

1. **Server** (`server.js`, `modules/`, `routes/`, `domains/`, `daos/`): Express app + a raw `ws` WebSocketServer sharing one HTTP(S) server. Express handles auth/OAuth, REST APIs, and EJS admin pages. The WebSocket server is the real-time backbone — game frames and control messages flow entirely over WS, not HTTP.
2. **Frontend** (`public/`, `views/`, `local_views/`): No build tooling — plain JS modules loaded directly by the browser and EJS-rendered HTML shells. `public/views/1p/` and `public/views/mp/` hold single-player and multiplayer *layouts* (each is a rendering skin: HTML/CSS/JS triplet meant to be dropped into OBS as a Browser Source at 720p). `modules/layouts.js` scans these directories at startup via `glob` to build the list of available layouts — adding a new layout is a filesystem convention, not a registration call.

### Connection routing is all in `routes/websocket.js`

Every WebSocket upgrade is manually dispatched by regex-matching `request.url` (there is no per-route handler abstraction like Express routes). Categories, in the order they're checked:
- `/ws/replay/<ids>` — replays stored games, no session needed
- `/ws/view/<layout>/<user_secret>` — a renderer/layout connecting as a *view*; resolves the owning user via `UserDAO.getUserBySecret` and fabricates a session
- `/ws/room/(u/<login>/)?(producer[12]?|emu)/<secret>` — a capture page connecting as a *producer*, optionally as a producer *into someone else's room* (competition/match mode) when the `u/<login>/` prefix is present
- `/ws/room/admin/<secret>` — the match-room admin control panel (blocked on public server unless routed through session-based auth)
- Anything else requires an established Express session (`request.session.user`)

Read this file first when touching anything connection-related; the in-memory domain objects below assume connections arrive already classified this way.

### Server-side domain model (`domains/`) — all in-memory, no per-connection persistence

- **`User`** (`domains/User.js`): one instance per logged-in user, kept alive in memory while it has active connections (auto-expires 30 min after last connection closes — see `checkScheduleDestroy`). Owns a `Producer`, a `PrivateRoom`, and a `MatchRoom`, and optionally joins another user's `MatchRoom` for head-to-head play. Also owns the optional Twitch chat client (`@twurple`) relaying chat/sub/raid events to connected clients.
- **`Producer`** (`domains/Producer.js`): wraps the capture-page WebSocket connection for a user. Parses incoming binary game frames vs JSON control messages, and owns the current `Game` instance (`modules/Game.js`), recreating it whenever a new game start is detected in the frame stream.
- **`Room`** (`domains/Room.js`, base class) / **`PrivateRoom`** / **`MatchRoom`**: fan out producer messages to connected view (renderer) connections. `MatchRoom` is the interesting one — it models up to `MAX_PLAYERS` (16) player slots, an admin control connection, auto-join logic, best-of-N/victories tracking, and a large command switch (`handleAdminMessage`) that is the actual protocol for the match-room admin UI.
- **`Connection`** (`modules/Connection.js`): thin `EventEmitter` wrapper around a raw `ws` socket — handles ping/pong keepalive, binary-vs-JSON message decoding (binary always means a game frame, decoded via `public/js/BinaryFrame.js`), and a "kick" sequence (send `_kick`, close, then hard-destroy after a delay so the client has time to see the message).

### Wire protocol

- **Control messages**: JSON arrays, `[command, ...args]`, sent as plain WS text frames. Most of the domain classes' message handling is just switching on `message[0]`.
- **Game frames**: a fixed 74-byte binary format (see `docs/schema.md` for the full byte layout) encoded/decoded by `public/js/BinaryFrame.js`, shared verbatim between server and browser code (this is why `jest.config.js` maps `/js/*` and `/views/*` to `public/js`/`public/views` — tests import the same frontend modules the browser loads).
- Score/stat computation from raw frames happens both client-side (live rendering, in `public/views/*.js`) and server-side (persisted scores via `modules/Game.js` → `daos/ScoreDAO.js` → Postgres `scores` table).

### Data layer

- `modules/db.js` exports a single shared `pg.Pool`, configured from `DATABASE_URL`.
- `daos/` (`UserDAO`, `ScoreDAO`) are the only modules that issue SQL directly — raw parameterized queries, no ORM.
- `domains/ScoreService.js` sits above `ScoreDAO` for query-option parsing/validation (allowed sort fields/dirs, page size clamped to `server.max_page`, competition-flag filtering) — extend validation there rather than in routes or the DAO.
- Schema evolves via dated one-off SQL files in `setup/` (e.g. `20250630.sql`) rather than a migration framework; `setup/db.sql` is the baseline.

### Config

All environment variables are declared and validated centrally in `modules/config.js` via `convict` (with a custom `boolean-string` format for env vars like `"true"`/`"1"`). `config.validate({ allowed: 'strict' })` runs at import time, so an unrecognized/undeclared env var will crash startup — always add new env vars to this schema rather than reading `process.env` directly elsewhere.
