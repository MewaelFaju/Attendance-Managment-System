# Attendance System

Full-stack employee attendance management.

| Layer    | Tech |
|----------|------|
| Frontend | Static HTML/CSS/vanilla JS in `public/` (no build step), light + dark theme |
| API      | Node.js + Express 5 (`server/`) |
| Database | SQLite via Node's built-in `node:sqlite` (file at `data/attendance.db`) |
| Auth     | JWT (HS256) + bcrypt password hashes, roles `admin` / `employee` |

Requires **Node 22.5+** (developed on Node 24).

## Run

```powershell
npm install
npm start          # http://localhost:3000
```

On the first run an admin account is created. Its password is printed to the console **once**
(or set `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env` first; see `.env.example`).
Change it afterwards with **Change password** in the top bar.

```powershell
npm run dev        # restart on file changes
npm test           # API + backup tests (in-memory databases)
npm run backup     # write a database snapshot now
```

Open the app through the Node server (`http://localhost:3000`). Opening `public/index.html` from
VS Code Live Server (port 5500) also works, as long as the Node server is running.

## Use it from phones and other computers (same Wi-Fi)

The app runs on one computer (the "server PC"); everyone else opens it in their browser over the workplace Wi-Fi.
Nothing is exposed to the internet.

1. **Start the server** by double-clicking `start-server.bat` (keep the window open; closing it stops the app).
   To start it automatically at sign-in: press `Win+R`, type `shell:startup`, and put a shortcut to that file there.
2. **Allow other devices, once.** Windows blocks incoming connections by default. Open PowerShell **as
   Administrator** and run:
   `powershell -ExecutionPolicy Bypass -File "<project folder>\scripts\allow-phone-access.ps1"`.
   It adds one firewall rule (port 3000, local network only) and, if the Wi-Fi is marked *Public*, offers to mark it
   *Private*. Undo with `Remove-NetFirewallRule -DisplayName "Attendance System (TCP 3000)"`.
3. **Connect phones:** on the server PC open `http://localhost:3000/connect` (admins also have a **Phone access**
   button), and scan the QR code with the phone camera. Then, on the phone, *Add to Home Screen* (iPhone: Safari
   Share menu; Android: Chrome menu) to get an app icon.
4. **Give staff logins:** in *Employees* set a *Login Password* for each person (they sign in with their email).

Things to know:

- The server PC must be on, awake and connected to the Wi-Fi. Turn off sleep in Windows power settings.
- The PC's address (e.g. `192.168.1.22`) can change after a router restart. To keep it fixed, reserve the address for
  this PC in your router ("DHCP reservation"), or just re-open `/connect` to get the new one.
- The connection is plain `http` inside your own network. Use a Wi-Fi password (WPA2/WPA3) and don't let visitors
  onto the same network (use the router's guest network for them).
- People only reach it while on that Wi-Fi, so check-ins can only happen at the workplace.

## Features

- **Dashboard:** today's attendance rate, stat tiles, 7-day on-time/late chart (with table view), "team right now" cards.
- **Attendance:** check in/out, admin corrections (edit times / delete a record), reset all data.
- **Filters & reports:** filter by employee and date range (today, last 7 days, this month, last month, custom);
  status report (on time / late / absent today); **monthly summary** per employee (days worked, late days, hours).
- **CSV export:** attendance records (current filters) and the monthly summary. Formula-looking text is neutralised
  and a BOM is added so Excel opens UTF-8 names correctly.
- **Accounts:** every user can change their own password; changing it signs out all their other sessions.
- **Dark mode:** toggle in the top bar (remembers your choice, defaults to the OS setting).

## Roles

- **admin**: manage employees, check anyone in/out, see every record, correct/delete records, reset attendance data.
- **employee**: created by giving an employee a *Login Password* in the Employees form; they sign in with
  their email and can only check themselves in/out and see their own data.

## Rules

- One record per employee per day. Checking in twice, or out before in, returns `409`.
- **Work schedule** (server local time, set in `.env`): `WORK_START` 08:45, `WORK_END` 17:30, `WORK_END_SAT` 16:30,
  `WORK_DAYS` Monday-Saturday. On the Ethiopian clock these are 2:45 / 11:30 / 10:30 (Ethiopian time is the
  international time shifted by 6 hours). The app stores standard time and displays Ethiopian date and time
  (with the Gregorian date underneath); the UI switches between English and Amharic.
- Check-in after `WORK_START` is marked **late**; check-out before `WORK_END` is flagged **early**. Correcting a
  check-in time recomputes the day and the on-time/late status.
- **Absent** = no check-in on a work day (computed, not stored). Days off (Sunday by default) never count as
  absences; someone who checks in on a day off is simply recorded. The monthly summary counts **absent days**
  from the day the employee was added, for days that are over (through yesterday, or today once `WORK_END` passed).
- Deleting an employee also deletes their login and attendance records.

## API

All routes except `POST /api/auth/login` and `GET /api/health` need `Authorization: Bearer <token>`.

| Method | Path | Notes |
|--------|------|-------|
| GET    | `/api/health` | public liveness check |
| POST   | `/api/auth/login` | `{username, password}` → `{token, user}`; rate-limited per IP |
| GET    | `/api/auth/me` | current user |
| POST   | `/api/auth/change-password` | `{currentPassword, newPassword}` → new `{token}`; old tokens stop working |
| GET    | `/api/employees` | admin: all; employee: self only |
| POST   | `/api/employees` | admin. `{name, email, role, idCard, photo?, password?}` |
| PUT    | `/api/employees/:id` | admin. Omit `photo` to keep it, `null` to clear |
| DELETE | `/api/employees/:id` | admin |
| POST   | `/api/attendance/check-in` | `{employeeId}` (ignored for employees) |
| POST   | `/api/attendance/check-out` | `{employeeId}` (ignored for employees) |
| GET    | `/api/attendance` | filters: `employeeId`, `status` (present/late/absent), `from`, `to` (YYYY-MM-DD) |
| GET    | `/api/attendance/report` | same filters → `{summary, records}` |
| GET    | `/api/attendance/export.csv` | same filters, as a download |
| GET    | `/api/attendance/monthly?month=YYYY-MM` | per-employee monthly totals |
| GET    | `/api/attendance/stats` | today's totals and records |
| GET    | `/api/attendance/trend?days=7` | per-day on-time/late counts |
| PUT    | `/api/attendance/:id` | admin. `{checkIn, checkOut?}` ISO times; no future times |
| DELETE | `/api/attendance/:id` | admin |
| DELETE | `/api/attendance` | admin. Deletes all attendance records |

## Backups

The server snapshots the database (`VACUUM INTO`, safe while running) to `backups/` at startup and then whenever the
newest backup is older than `BACKUP_INTERVAL_HOURS` (default 24), keeping the last `BACKUP_KEEP` (default 14).
`npm run backup` takes one on demand.

**Restore:** stop the server, delete `data/attendance.db-wal` and `data/attendance.db-shm` if present, copy a file
from `backups/` over `data/attendance.db`, start the server. Also copy `backups/` somewhere off this machine
occasionally, since a backup on the same disk doesn't protect against losing the disk.

## Deploy with Docker

```bash
docker compose up -d --build            # http://localhost:3000 (bound to 127.0.0.1 by default)
```

Data and backups live in named volumes. Put `ADMIN_PASSWORD` in `.env` before the first start (or read the generated
one from `docker compose logs app`).

HTTPS on a public domain (Caddy fetches and renews the certificate; ports 80/443 must reach the host):

```bash
# .env:  DOMAIN=attendance.example.com   TRUST_PROXY=1   TZ=Africa/Addis_Ababa
docker compose --profile https up -d --build
```

Set `TZ` to your timezone: the on-time/late cutoff and the "today" boundary use the server's local time.
Set `TRUST_PROXY=1` only when running behind Caddy/nginx; otherwise clients could spoof their IP and dodge the login
rate limit. Set `JWT_SECRET` explicitly if you ever run more than one instance.

> The Docker files have not been built or run in this repository's development environment (Docker wasn't
> available there), so expect to fix small things on the first `docker compose up`.

## Layout

```
server/   index.js (entry) · app.js · config.js · db.js (schema) · auth.js · backup.js · routes/
public/   index.html · style.css · script.js · theme.js · manifest.webmanifest · icons/
scripts/  backup.js · allow-phone-access.ps1 · make-icons.js
start-server.bat
deploy/   Caddyfile
test/     api.test.js · backup.test.js
Dockerfile · docker-compose.yml
```

The original standalone mock-up pages (`index.html`, `Attendance System*.html`) in the project root are untouched
and no longer used.
