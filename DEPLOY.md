# Deploying the Data Logger to the cloud (run it forever, no PC needed)

This guide takes the project from "runs on my laptop" to "hosted online 24/7".

---

## First, the important reality check

**GitHub does NOT run your server.** GitHub stores your *code*. GitHub Pages
can only serve *static* files — it cannot run Node.js, cannot hold a WebSocket
connection, and cannot write to a database. So GitHub's role here is only to
**hold the code**; an actual application host then deploys and runs it.

So the setup is two pieces:
1. **GitHub** — stores the code (free).
2. **An app host** — pulls from GitHub and runs the Node server 24/7.

---

## Choosing a host (real tradeoffs)

Your logger writes sensor data every second, so it must stay **always-on** and
must **keep its database on a persistent disk** — otherwise history is lost on
every restart/redeploy.

| Host | Always-on | Persistent data | Cost | Ease |
|---|---|---|---|---|
| **Fly.io** | Yes (`min_machines_running=1`) | **3GB volume** | Requires a card; a tiny always-on VM + 1GB volume is very low cost (~a couple $/mo, often within monthly allowances) | CLI-driven |
| **Render** | Yes (kept awake by ingest) | Disk needs **paid** plan (~$7/mo) | Free tier loses data on redeploy | Easiest UI |
| **Railway** | Yes | Volume on Hobby plan (~$5/mo) | Small monthly cost | Easy UI |

- **Want truly free + keep your data → Fly.io** (a `fly.toml` is included).
- **Want the simplest clicks and don't mind ~$7/mo → Render** (a `render.yaml`
  is included). On Render's *free* tier the SQLite file is wiped on each
  redeploy — okay only for a demo.

Both are configured to mount a persistent volume at `/data` and point
`DB_PATH` there, so your history survives restarts.

---

## Step 1 — Put the code on GitHub

You (the account owner) do this part, because it needs your login/token:

1. Create a new **empty** repo at github.com (e.g. `data-logger`), private is fine.
2. Install Git if needed: https://git-scm.com/download/win
3. In this project folder:
   ```bash
   git init
   git add .
   git commit -m "Data Logger server + dashboard"
   git branch -M main
   git remote add origin https://github.com/<your-username>/data-logger.git
   git push -u origin main
   ```
   When prompted for a password, paste a **Personal Access Token** (GitHub →
   Settings → Developer settings → Personal access tokens), NOT your account
   password (password auth is disabled by GitHub).

`.gitignore` already excludes `node_modules/`, the SQLite files, and `.env`, so
no secrets or bulky files get committed.

---

## Step 2 — Deploy (example: Fly.io, free + persistent)

1. Install flyctl: https://fly.io/docs/flyctl/install/  → `fly auth signup`
2. In the project folder:
   ```bash
   fly launch --no-deploy        # adopts the included fly.toml; pick a unique app name
   fly volumes create data --size 1 --region sin
   fly secrets set API_KEY=<make-up-a-long-random-string>
   fly deploy
   ```
3. Your public URL will be `https://<your-app>.fly.dev`.

### Example: Render (UI)
1. render.com → New → Blueprint → connect your GitHub repo → it reads `render.yaml`.
2. Confirm the `starter` plan (needed for the persistent disk) and deploy.
3. Your public URL will be `https://<your-app>.onrender.com`.

---

## Step 3 — Point the ESP32 at the cloud

1. In `DataLogger_ESP32_WebServer.ino`, set:
   ```cpp
   const char *SERVER_URL = "https://<your-app>.fly.dev/api/ingest";
   const char *DEVICE_API_KEY = "<the same API_KEY you set on the host>";
   ```
   The firmware already auto-switches to a TLS (HTTPS) client for `https://` URLs.
2. Re-flash the ESP32. It will now POST to the cloud from anywhere with WiFi.

Open `https://<your-app>...` in any browser, anywhere — that's your shareable,
always-on dashboard link.

---

## Security once it's public (read this)

Going public means **anyone with the URL** can reach it. Two things to set:

1. **Protect ingest** — set an `API_KEY` on the host and the same
   `DEVICE_API_KEY` in the firmware (steps above). Without it, strangers could
   POST fake readings.
2. **The dashboard itself is currently open** — anyone with the link can view
   data *and* rename devices, edit formulas, recalibrate, and clear logs (those
   are destructive). If this URL will be shared beyond people you trust, ask me
   to add a login/password gate in front of the write actions before you go
   public.

---

## Will it handle many people at once?

Yes, for realistic use. The workload is light — the server broadcasts one small
snapshot per second and serves a static page — so a single small instance
comfortably handles **hundreds of simultaneous dashboard viewers** over
WebSocket. gzip compression and SQLite WAL mode (both enabled) keep it smooth.

If you ever needed *thousands* of concurrent users, that would require running
multiple instances behind a load balancer with a Redis adapter for Socket.IO
and a managed Postgres database instead of SQLite — a larger change we can make
if/when that scale is real. It is overkill for an internal sensor dashboard.
