# Data Logger — Web Dashboard & Calibration Server

Production-grade multi-device web platform for the ATmega4808 + ESP32 data
logger. Shows live per-channel temperatures, lets you **rename channels**,
**start/stop recording into named sessions**, tune the conversion formula per
channel, capture a master (reference-thermometer) calibration, set **threshold
alarms**, view **live trend charts** and **statistics**, and export data as
**CSV / Excel / JSON** plus a **printable report** — all served over your LAN
(or the cloud) with **role-based access control** (Admin / Engineer login).

The firmware layer is unchanged in contract: the ESP32 POSTs raw readings to
`/api/ingest`. **All temperature math happens on the server**, from per-channel
formula parameters stored in SQLite.

## What's new (production upgrade)

- **Renamable channels** — give each PT100/TC a human name + unit; names flow
  into the live UI and every CSV/Excel/JSON header and filename.
- **Start/Stop recording + named sessions** — data is written to the database
  **only while recording**, which minimizes storage. The **live dashboard keeps
  updating even when stopped** (served from an in-memory cache). Each Start
  opens a session (name/operator/notes) you can export or report on later.
- **Storage-rate control** — choose how often samples are persisted
  (1/sec … 1/min) to control database growth.
- **Threshold alarms** — per-channel low/high limits with a live banner,
  audible beep, and a persisted alarm event log.
- **Live trend charts** — per-channel and multi-channel overlay (Recharts).
- **Statistics** — live min/max/avg/std-dev over a selectable window.
- **Exports & reports** — CSV, Excel (`.xlsx`), JSON, and a print-to-PDF report,
  each scopable by time range and session.
- **Role-based access control (always-on)** — Admin and Engineer roles.
  Admins manage users; Engineers have full app access but no user management.
  First admin seeded from `ADMIN_USER`/`ADMIN_PASSWORD` on first boot.
- **Diagnostics** — WiFi RSSI, free heap, ESP uptime, I2C fault count, firmware
  version (ESP32 firmware **v8** sends these each cycle and drives a status LED
  from the recording state).

---

## Quick start

```bash
# 1. Install backend deps (once)
npm install

# 2. Build the frontend (once, and after any UI change)
npm run build:frontend

# 3. Run the server
npm start
```

Then open **http://localhost:8080** on the laptop, or
**http://<laptop-LAN-IP>:8080** from any device on the same WiFi.

### No hardware? Simulate a device
In a second terminal, with the server running:
```bash
npm run simulate                 # device "sim-logger-01"
npm run simulate -- my-device    # custom device id
```
It POSTs a realistic payload every second (10 PT100 + 2 TC channels; PT100 #9/#10
simulate "no hardware"). Point it elsewhere with `SERVER_URL=http://192.168.1.50:8080 npm run simulate`.

---

## Development mode (hot reload UI)

```bash
npm start                        # backend on :8080  (terminal 1)
npm --prefix frontend run dev    # Vite dev server on :5173 (terminal 2)
```
Open the Vite URL; it proxies `/api` and `/socket.io` to the backend. For
production/LAN use, always `npm run build:frontend` and serve via `npm start`
(single port, single process).

---

## LAN hosting checklist

1. `npm start` — the server binds `0.0.0.0:8080` by default, so it is reachable
   from other devices on the WiFi (override with `HOST` / `PORT` env vars).
2. Find the laptop's LAN IP: `ipconfig` (Windows) / `ifconfig` (mac/Linux) → e.g. `192.168.1.50`.
3. Anyone on the same WiFi opens `http://192.168.1.50:8080` — the whole app
   (dashboard / grid / detail) is client-side routed from one static build.
4. The ESP32's `SERVER_URL` points at `http://192.168.1.50:8080/api/ingest` — unchanged.
5. **Firewall:** allow inbound TCP 8080 from the local subnet.
6. Give the laptop a **static IP or DHCP reservation** — otherwise the ESP32's
   `SERVER_URL` and everyone's bookmarks break when the lease changes.
7. Optional ingest auth: set `API_KEY=...` and the ESP32 must send a matching
   `X-Device-Key` header. This guards `/api/ingest` only; the dashboard stays
   open (it's a trusted LAN). If you ever expose it beyond the LAN, add auth in
   front of the dashboard too.

---

## Configuration (environment variables)

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address (use `127.0.0.1` to restrict to the laptop) |
| `API_KEY` | _(none)_ | If set, `/api/ingest` requires header `X-Device-Key: <key>` |
| `DB_PATH` | `data/data_logger.db` | SQLite file location |
| `STALE_MS` | `10000` | A device is "active" if seen within this window |
| `RETENTION_DAYS` | `30` | Prune readings older than this (0 = keep forever) |
| `SAMPLE_INTERVAL_MS` | `1000` | Default storage rate (ms between persisted samples per channel) |
| `ADMIN_USER` | `admin` | Username for the first admin (seeded on first boot only) |
| `ADMIN_PASSWORD` | `admin` | Password for the first admin (seeded on first boot only; **change after login**) |
| `JWT_SECRET` | _(dev default)_ | HMAC secret for the login cookie — **set this in production** |
| `AUTH_TOKEN_TTL` | `7d` | JWT token lifetime |

> **Deprecated:** `DASHBOARD_PASSWORD` and `DASHBOARD_USER` are still accepted as
> fallback seeds for `ADMIN_PASSWORD`/`ADMIN_USER` respectively, but they no longer
> control whether auth is enabled. Auth is **always on**.

### Authentication & roles (always on)

Login is **always required**. The dashboard uses role-based access control with
two roles:

| Role | Access |
|---|---|
| **Admin** | Full access. Can create, remove, and reset any user (Admin or Engineer). Sees the Users management page. |
| **Engineer** | Full app access (devices, recording, exports, etc.) but **no user management**. Can change only their own password. |

**First-boot seeding:** On the very first start (when the `users` table is empty),
the server creates an admin account from `ADMIN_USER` / `ADMIN_PASSWORD`. If you
use the defaults (`admin` / `admin`), a loud console warning reminds you to
change the password. This seed **never** runs again once any user exists.

```bash
ADMIN_USER=myadmin ADMIN_PASSWORD='strong-pass' JWT_SECRET='long-random' npm start
```

**Safety guards:**
- The last admin cannot be deleted or demoted, preventing lockout.
- You cannot delete your own account.
- `/api/ingest` is **never** gated by dashboard auth (devices use `API_KEY`
  instead), so the ESP32 keeps working regardless.

### Recording, sessions & storage rate

- Open a device, press **Start recording**, optionally name the session and
  pick a storage rate. Readings are written to the DB only while recording.
- **Stopped ≠ blind:** live values, charts and alarms keep updating from an
  in-memory cache; only persistence pauses.
- Past sessions appear under the **Sessions** tab with reading counts and
  per-session CSV/Excel/report links.

### Channel naming, alarms & stats

- On a channel's detail page, **Channel settings** lets you rename it, set a
  unit, enable/disable it, and configure **low/high alarm thresholds**.
- Alarms raise a banner + beep and are logged under the device **Alarms** tab.
- The **Statistics** panel shows live min/max/avg/std-dev over a window.

### Exports & reports

Every export supports an optional time range and session scope:
- **CSV** / **Excel (.xlsx)** / **JSON** — per channel or whole device.
- **Report** — a printable HTML summary (per-channel stats + alarm log); use
  the browser's Print → Save as PDF.

---

## How the pages work

- **Dashboard (`/`)** — all devices ever seen ("available") + which are online
  ("active"). Rename a device inline; a `REC` badge shows active recording.
  "Open" enters a device (works whether online or offline, so you can review
  history/sessions anytime).
- **Device hub (`/devices/:id`)** — a recording bar (Start/Stop + session +
  storage rate) plus tabs: **Overview** (channel tiles, live), **Charts**
  (multi-channel trend), **Sessions**, **Alarms**, **Diagnostics**, **Export**.
- **Channel detail (`/devices/:id/:type/:num`)** — big live numbers, live trend
  chart, statistics, the formula editor, master calibration, **channel settings**
  (rename / unit / enable / alarm thresholds), a live readings table, and
  per-channel exports.

---

## Master calibration (the important behavior)

- **Calculated** temperature = `formula(raw, params)`. This is the channel's own
  track; editing the formula changes it going forward.
- **Set master:** you type a physically-verified reference temperature `M_ref`.
  The server stores `error_factor = M_ref − calculated_now`. From then on, every
  reading computes `master = calculated + error_factor` — a live value that
  tracks the sensor, shifted by the offset found at calibration time. The
  calculated value is **never** altered.
- **Editing the formula later** shifts master too (it's `calculated + offset`),
  but the offset itself is **not** recomputed automatically. The UI hints that
  you may want to recalibrate. Each row in the log stores the offset used at
  that moment, so historical CSV rows stay correct even after recalibration.
- **Clear master:** master goes blank (live view shows `—`, "with master" CSV
  has blank master cells for rows after the clear). Calculated keeps flowing.

---

## API reference

| Method & path | Purpose |
|---|---|
| `POST /api/ingest` | ESP32 ingest (optional `X-Device-Key`); response echoes `{recording, session_id}` |
| `POST /api/login` · `POST /api/logout` · `GET /api/auth/status` | Auth (always on) |
| `GET /api/me` | Current user `{username, role}` |
| `POST /api/me/password` | Change own password `{current_password, new_password}` |
| `GET /api/users` | _(admin)_ List all users |
| `POST /api/users` | _(admin)_ Create user `{username, password, role}` |
| `DELETE /api/users/:id` | _(admin)_ Remove user (guard: not self, not last admin) |
| `POST /api/users/:id/reset-password` | _(admin)_ Reset password `{new_password}` |
| `PATCH /api/users/:id/role` | _(admin)_ Change role `{role}` (guard: can't demote last admin) |
| `GET /api/devices` | Device list `[{device_id, display_name, active, last_seen, recording}]` |
| `PATCH /api/devices/:id` | Rename `{display_name}` |
| `PATCH /api/devices/:id/settings` | Device settings `{sample_interval_ms}` |
| `GET /api/devices/:id/data` | Latest converted snapshot (all channels + recording + diagnostics) |
| `POST /api/devices/:id/recording/start` | Start recording `{name, operator, notes, sample_interval_ms}` |
| `POST /api/devices/:id/recording/stop` | Stop recording (closes the session) |
| `GET /api/devices/:id/recording` | Current recording state |
| `GET /api/devices/:id/sessions?limit=N` | Recent sessions with reading counts |
| `GET /api/devices/:id/diagnostics` | Device health (RSSI, heap, uptime, fw, I2C fails) |
| `GET /api/devices/:id/alarms?limit=N` · `POST .../alarms/clear` | Alarm event log |
| `GET /api/devices/:id/channels/:type/:num` | Channel config + name/unit + master + alarm + latest |
| `PATCH .../channels/:type/:num` | Channel meta `{display_name, unit, enabled}` |
| `PUT .../channels/:type/:num/formula` | Update formula params |
| `PUT .../channels/:type/:num/master` · `DELETE .../master` | Set / clear master calibration |
| `PUT .../channels/:type/:num/alarm` · `DELETE .../alarm` | Set / clear threshold alarm |
| `GET .../channels/:type/:num/stats?window_ms=N` | Live min/max/avg/std-dev/count |
| `GET .../channels/:type/:num/readings?limit=N` | Recent readings (JSON) |
| `GET .../channels/:type/:num/log.{csv,xlsx,json}?with_master=&from=&to=&session_id=` | Per-channel export |
| `POST .../channels/:type/:num/clear-log` | Clear a channel's readings |
| `GET /api/devices/:id/download/all.{csv,xlsx,json}?with_master=&from=&to=&session_id=` | Whole-device export |
| `GET /api/devices/:id/report?session_id=&from=&to=` | Printable HTML report |
| `POST /api/devices/:id/clear-log` | Clear all readings for a device |

`:type` is `pt100` (channels 1–10) or `tc` (channels 1–2). CSV/Excel/JSON
headers use each channel's **display name + unit**; disabled channels are
excluded from whole-device exports.

Real-time: clients open a Socket.IO connection, `emit('subscribe', deviceId)`,
and receive `device:update` (full snapshot on each ingest), `device:status`
(online/offline), `device:recording` (start/stop), and `alarm:event`
(threshold transitions). Falls back to HTTP polling automatically.

### Ingest payload shape (v8)
```json
{
  "device_id": "datalogger-01",
  "atmega_online": true,
  "wifi_rssi": -58, "free_heap": 210000, "i2c_consec_fails": 0, "fw_version": "v8",
  "time_valid": true,
  "time": "14:03:22",
  "date": "2026-08-24",
  "epoch": 1787654602,
  "pt100": [ { "ch": 1, "raw_mV": 41.2, "status": 0, "hw_available": true, "valid": true }, ... ],
  "tc":    [ { "ch": 1, "raw12": 428, "fault": false, "valid": true }, ... ]
}
```
`time`/`date` come from the ESP32's **NTP** clock. The `wifi_rssi`/`free_heap`/
`i2c_consec_fails`/`fw_version` diagnostics (v8) are optional; older firmware
still works. The server also accepts the legacy nested `rtc: {valid,time,date}`.

---

## Project layout

```
server.js            Express + Socket.IO bootstrap, auth wiring, static serve, retention prune
config.js            Env-driven config (incl. auth + storage-rate) + default formula params
temperature.js       Config-driven pt100 / tc conversion
calibration.js       Pure master-calibration functions
live.js              In-memory live cache (keeps UI live while not recording)
recording.js         Session lifecycle + storage-rate (decimation) gate
alarms.js            Threshold evaluation + per-channel transition state machine
auth-util.js         JWT sign/verify helpers (shared by auth route + sockets)
snapshot.js          Per-device converted snapshot (live-cache first, DB fallback)
realtime.js          Socket.IO rooms + broadcast helpers (+ auth handshake)
db/schema.sql        devices / channel_config / sessions / alarm_events / readings DDL
db/db.js             better-sqlite3 connection, in-place migrations, prepared statements
routes/              ingest, devices, channels, logs (csv/xlsx/json), reports, auth
scripts/simulate.js  Hardware-free ingest simulator (v8 payload)
frontend/            React + Vite app (built to frontend/dist, served by Express)
data/                SQLite file (gitignored)
```

---

## Notes

- **Timestamps (NTP):** the ESP32 gets accurate wall-clock time over the
  internet via NTP and sends `time`/`date`/`epoch` in every POST. The DS1307
  hardware RTC is no longer used (the chip can stay on the board, unused). CSV
  exports and the live table use the device's NTP time; the server's own
  receipt time is only used for the active/offline (staleness) window.
- **Multiple devices** are supported natively — everything is keyed by
  `device_id`; the dashboard's active/available split pays off with 2+ boards.
- **Retention:** readings older than `RETENTION_DAYS` are pruned hourly.

---

## Firmware (ESP32 + ATmega4808)

Two `.ino` sketches ship with this project:

- **`Data_Logger/Data_Logger.ino`** — ATmega4808 sensor node (I2C slave).
  Samples PT100 (raw mV) + MAX6675 (raw12) and serves them over I2C. No changes
  needed; no temperature math and no RTC on this chip.
- **`DataLogger_ESP32_WebServer/DataLogger_ESP32_WebServer.ino`** — ESP32 I2C
  master + HTTP forwarder (**v8**). Polls the ATmega over I2C and POSTs raw JSON
  to this server every second. **Uses NTP internet time** (no DS1307), now also
  sends diagnostics (WiFi RSSI, free heap, I2C fault count, fw version) and
  drives an on-board **status LED** from the recording state returned by the
  server (solid = recording, slow blink = idle). Recording is controlled from
  the web UI; the firmware only reflects it. Optional `#define STATUS_LED_PIN`
  (default GPIO2).

### Configure the ESP32 sketch before flashing
Edit the top of `DataLogger_ESP32_WebServer.ino`:

| Constant | Set to |
|---|---|
| `WIFI_SSID` / `WIFI_PASSWORD` | Your WiFi (already `BSL_PUNE`) |
| `SERVER_URL` | `http://<laptop-LAN-IP>:8080/api/ingest` — currently `http://172.16.50.173:8080/api/ingest` |
| `DEVICE_ID` | Unique per board (default `datalogger-01`) |
| `DEVICE_API_KEY` | Leave blank unless you set `API_KEY` on the server |
| `GMT_OFFSET_SEC` | Timezone offset (India `19800` = GMT+5:30) |

Arduino libraries: **ArduinoJson** (Library Manager). `WiFi`, `HTTPClient`,
`Wire`, `time.h` are bundled with the ESP32 core.

> If the laptop's LAN IP changes, update `SERVER_URL` and re-flash — this is why
> a static IP / DHCP reservation for the laptop is recommended.
