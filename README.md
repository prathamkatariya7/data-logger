# Data Logger — Web Dashboard & Calibration Server

Multi-device web dashboard for the ATmega4808 + ESP32 data logger. Shows live
per-channel temperatures, lets you tune the conversion formula per channel,
capture a master (reference-thermometer) calibration, and export per-channel
CSV logs — all served over your LAN so any phone/laptop on the same WiFi can
view it in a browser.

The firmware layer is unchanged: the ESP32 still POSTs raw readings to
`/api/ingest`. **All temperature math happens on the server**, from
per-channel formula parameters stored in SQLite.

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

---

## How the pages work

- **Dashboard (`/`)** — all devices ever seen ("available") + which are online
  ("active"). Rename a device inline. "Log Data" opens an active device.
- **Channel grid (`/devices/:id`)** — every channel as a tile, showing
  calculated + master temperature side by side, updating live. "Download All Logs".
- **Channel detail (`/devices/:id/:type/:num`)** — big live numbers (calculated /
  master / raw), the formula editor, the master-calibration panel, a live
  readings table, and per-channel CSV downloads.

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
| `POST /api/ingest` | ESP32 ingest (unchanged contract; optional `X-Device-Key`) |
| `GET /api/devices` | Device list `[{device_id, display_name, active, last_seen}]` |
| `PATCH /api/devices/:id` | Rename `{display_name}` |
| `GET /api/devices/:id/data` | Latest converted snapshot for all channels |
| `GET /api/devices/:id/channels/:type/:num` | Channel config + master state + latest reading |
| `PUT /api/devices/:id/channels/:type/:num/formula` | Update formula params |
| `PUT /api/devices/:id/channels/:type/:num/master` | Set master `{reference_c}` |
| `DELETE /api/devices/:id/channels/:type/:num/master` | Clear master |
| `GET /api/devices/:id/channels/:type/:num/readings?limit=N` | Recent readings (JSON) |
| `GET /api/devices/:id/channels/:type/:num/log.csv?with_master=true\|false` | Per-channel CSV |
| `POST /api/devices/:id/channels/:type/:num/clear-log` | Clear a channel's readings |
| `GET /api/devices/:id/download/all.csv` | Whole-device CSV export |
| `POST /api/devices/:id/clear-log` | Clear all readings for a device |

`:type` is `pt100` (channels 1–10) or `tc` (channels 1–2).

Real-time: clients open a Socket.IO connection, `emit('subscribe', deviceId)`,
and receive `device:update` (full snapshot on each ingest) and `device:status`
(online/offline transitions). Falls back to HTTP polling automatically.

### Ingest payload shape
```json
{
  "device_id": "datalogger-01",
  "atmega_online": true,
  "time_valid": true,
  "time": "14:03:22",
  "date": "2026-08-24",
  "epoch": 1787654602,
  "pt100": [ { "ch": 1, "raw_mV": 41.2, "status": 0, "hw_available": true, "valid": true }, ... ],
  "tc":    [ { "ch": 1, "raw12": 428, "fault": false, "valid": true }, ... ]
}
```
`time`/`date` come from the ESP32's **NTP** clock (v7 firmware). The server also
accepts the legacy nested `rtc: {valid,time,date}` object from older firmware.

---

## Project layout

```
server.js            Express + Socket.IO bootstrap, static serve, retention prune
config.js            Env-driven config + default formula params
temperature.js       Config-driven pt100 / tc conversion (§5)
calibration.js       Pure master-calibration functions (§6)
snapshot.js          Builds the per-device converted snapshot (REST + WS share it)
realtime.js          Socket.IO rooms + broadcast helpers
db/schema.sql        devices / channel_config / readings DDL
db/db.js             better-sqlite3 connection + prepared statements
routes/              ingest, devices, channels, logs
scripts/simulate.js  Hardware-free ingest simulator
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
  master + HTTP forwarder (**v7**). Polls the ATmega over I2C and POSTs raw JSON
  to this server every second. **Uses NTP internet time** (no DS1307).

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
