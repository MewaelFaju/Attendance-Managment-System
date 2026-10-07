# Memory Match – PlayVerse

React + Express + MongoDB memory card game with JWT auth, server-authoritative gameplay and an admin dashboard.

## Run it

```bash
# 1. API (port 4000)
cd server
cp .env.example .env        # set JWT_SECRET and, optionally, MONGO_URI
npm install
npm start

# 2. Web client (port 5173, proxies /api to :4000)
cd client
npm install
npm run dev
```

- If `MONGO_URI` is empty the server starts a throw-away in-memory MongoDB (first run downloads the binary, ~600 MB; data is lost on restart). Set `MONGO_URI=mongodb://127.0.0.1:27017/memorymatch` for real persistence.
- Production: `npm --prefix client run build`, then `npm start` in `server/` serves the built client on port 4000.
- An admin account is seeded from `ADMIN_EMAIL` / `ADMIN_PASSWORD` (default `admin@playverse.local` / `Admin123!`). **Change these.**

## How cheating is prevented

The card layout lives only on the server. The client receives a card's symbol only in the response to flipping it, so the deck cannot be read from the network or DOM before playing.

- Server owns timer, moves, score, streak and result; the client only displays them.
- Flips are validated: index in range, card not matched, not the same card twice, game active and owned by the caller.
- Per-game lock rejects concurrent/double-click flips; per-user rate limit on `/flip`.
- Time limit enforced server-side (a game left idle is settled as a loss).
- Starting a new game retires the old one; quitting counts as a loss.
- Zod validation on every body, ObjectId checks, Helmet, CORS, rate limits, bcrypt (cost 12), JWT (7 d), suspended users blocked on every request.

## API

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/register`, `/login` | returns `{token,user}` |
| GET | `/api/auth/me` | |
| GET | `/api/game/difficulties` | enabled levels |
| POST | `/api/game/start` | `{difficulty}` |
| GET | `/api/game/active` | resume running game |
| POST | `/api/game/:id/flip` | `{index}` |
| POST | `/api/game/:id/abandon` | |
| GET | `/api/game/history`, `/leaderboard` | |
| * | `/api/admin/stats`, `/difficulties`, `/users`, `/games` | admin only |

## Scoring (all editable per difficulty in the admin panel)

`match = matchPoints + streak × streakBonus` · `mismatch = −mismatchPenalty` (never below 0) · win adds `remaining seconds × timeBonusPerSecond` and `winReward` coins.
