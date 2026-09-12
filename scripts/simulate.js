'use strict';

// Simulator: POSTs fake ingest payloads shaped exactly like the ESP32 firmware,
// so you can develop/test the whole stack without hardware.
//   node scripts/simulate.js               -> device "sim-logger-01"
//   node scripts/simulate.js sim-02         -> custom device id
//   SERVER_URL=http://192.168.1.50:3000 node scripts/simulate.js
const deviceId = process.argv[2] || 'sim-logger-01';
const base = process.env.SERVER_URL || 'http://127.0.0.1:8080';
const url = `${base.replace(/\/$/, '')}/api/ingest`;
const apiKey = process.env.API_KEY || null;

let tick = 0;

function pad(n) { return String(n).padStart(2, '0'); }

function payload() {
  tick++;
  const now = new Date();
  // PT100: raw_mV wanders around a value that yields a sensible temp.
  const pt100 = [];
  for (let n = 1; n <= 10; n++) {
    const base_mV = 40 + n * 2 + Math.sin(tick / 10 + n) * 3;
    pt100.push({
      ch: n,
      raw_mV: +(base_mV + Math.random()).toFixed(2),
      status: n <= 8 ? 0 : 1,
      hw_available: n <= 8, // channels 9,10 simulate no hardware
      valid: true,
    });
  }
  const tc = [];
  for (let n = 1; n <= 2; n++) {
    tc.push({
      ch: n,
      raw12: Math.round(400 + n * 50 + Math.sin(tick / 8 + n) * 40 + Math.random() * 5),
      fault: false,
      valid: true,
    });
  }
  return {
    device_id: deviceId,
    atmega_online: true,
    atmega_status: 1,
    atmega_uptime_ms: tick * 1000,
    esp_uptime_ms: tick * 1000,
    // v8 diagnostics
    wifi_rssi: -50 - Math.round(Math.random() * 25),
    free_heap: 210000 + Math.round(Math.random() * 8000),
    i2c_consec_fails: 0,
    fw_version: 'sim-v8',
    // v7 firmware contract: NTP time sent at the top level.
    time_valid: true,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    epoch: Math.floor(now.getTime() / 1000),
    pt100,
    tc,
  };
}

async function post() {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-Device-Key': apiKey } : {}),
      },
      body: JSON.stringify(payload()),
    });
    if (!res.ok) console.error(`ingest failed: ${res.status} ${await res.text()}`);
    else if (tick % 5 === 0) {
      let rec = '';
      try { rec = (await res.json()).recording ? ' [recording]' : ''; } catch (_) {}
      console.log(`[${deviceId}] posted tick ${tick}${rec}`);
    }
  } catch (e) {
    console.error('post error:', e.message);
  }
}

console.log(`Simulating "${deviceId}" -> ${url} (Ctrl+C to stop)`);
post();
setInterval(post, 1000);
