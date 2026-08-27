/* ============================================================================
 *  ESP32 - I2C MASTER + HTTP FORWARDER  (v7 - NTP time, no DS1307)
 *  Polls the ATmega4808 sensor node (PT100 x10 raw mV + MAX6675 x2 raw12) over
 *  the 5V I2C bus (level-shifted from the ESP32's native 3.3V I2C via TXS0108E)
 *  and POSTs a raw-data JSON snapshot to the server on your laptop every cycle.
 *  Does NOT host a webpage, does NOT log to a local file, and does NOT compute
 *  any temperature.
 *
 *  CHANGE IN v7 - TIMEKEEPING MOVED TO NTP (INTERNET):
 *    The DS1307 hardware RTC is NO LONGER USED. All the I2C RTC reading and
 *    the compile-time-seeding logic from v6 has been REMOVED. The ESP32 now
 *    gets accurate wall-clock time over the internet via NTP (SNTP), and sends
 *    that timestamp to the server in every POST. The DS1307 chip can stay on
 *    the board unused - nothing here talks to address 0x68 anymore.
 *
 *    Everything else is unchanged from v6: the ATmega4808 I2C block layout,
 *    the raw-only payload (no temperature math on-device), and the I2C bus
 *    recovery for the level shifter (still needed for the ATmega path - it is
 *    unrelated to the RTC removal).
 * ----------------------------------------------------------------------------
 *  BOARD / TOOLCHAIN
 *    Arduino IDE, ESP32 board package (espressif/arduino-esp32 2.x+)
 *    Board:  "DEVKIT_V1_ESP32-WROOM-32" or any ESP32 dev board.
 *  LIBRARIES (Library Manager)
 *    ArduinoJson  by Benoit Blanchon   (JSON building for the HTTP POST body)
 *    Wire, WiFi, HTTPClient, time.h - all bundled with the ESP32 core, no
 *    separate install needed.
 * ----------------------------------------------------------------------------
 *  PIN MAP
 *    I2C (Wire, master)   SDA = IO22 (SDA_1)   SCL = IO21 (SCL_1)
 *  I2C BUS MAP
 *    0x30  ATmega4808 sensor node (custom register/command protocol, v4 blocks)
 *    (0x68 DS1307 RTC - present on board but NO LONGER READ)
 * ============================================================================
 */

#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>   // HTTPS POST to a cloud server
#include <ArduinoJson.h>
#include "time.h"   // NTP / SNTP wall-clock time

// ----------------------------------------------------------------------------
// >>>>>>>>>>>>>>>>>>>>>>>>>>>> FILL THESE IN <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
// ----------------------------------------------------------------------------
const char *WIFI_SSID     = "BSL_PUNE";
const char *WIFI_PASSWORD = "BSL@tech2024!";

// Your laptop's LAN IP and the port the data logger server listens on.
// Must be reachable from the ESP32's WiFi (same subnet, laptop firewall
// allowing the port, laptop IP not changing - set a DHCP reservation or a
// static IP for the laptop). Update the IP if your laptop's address changes.
// Where to POST. Two modes:
//   LAN  (server on your laptop):  http://<laptop-ip>:8080/api/ingest
//   CLOUD (server hosted online):  https://<your-app>.onrender.com/api/ingest
// The sketch auto-detects http vs https from the URL below. When you deploy to
// the cloud (see DEPLOY.md), paste your public HTTPS URL here and re-flash.
const char *SERVER_URL = "http://172.16.50.173:8080/api/ingest";
// Example after deploying:
// const char *SERVER_URL = "https://data-logger-xxxx.onrender.com/api/ingest";

// Optional shared secret so random devices on the LAN can't post fake data.
// Must match API_KEY on the server - leave both blank to disable.
const char *DEVICE_API_KEY = "";

const char *DEVICE_ID = "datalogger-01";

// ----------------------------------------------------------------------------
// NTP time configuration (v7). India = GMT+5:30, no daylight saving.
//   GMT_OFFSET_SEC = 5*3600 + 30*60 = 19800
// If you are in a different timezone, change GMT_OFFSET_SEC accordingly.
// ----------------------------------------------------------------------------
const long  GMT_OFFSET_SEC      = 19800;   // +05:30 (IST)
const int   DAYLIGHT_OFFSET_SEC = 0;
const char *NTP_SERVER_1 = "pool.ntp.org";
const char *NTP_SERVER_2 = "time.google.com";
const char *NTP_SERVER_3 = "time.cloudflare.com";

// ----------------------------------------------------------------------------
// I2C addresses / commands (must match atmega4808 sensor node v4)
// ----------------------------------------------------------------------------
#define ATMEGA_ADDR          0x30

#define CMD_ID_STATUS        0x00
#define CMD_PT100_BLOCK_A    0x10
#define CMD_PT100_BLOCK_B    0x11
#define CMD_PT100_BLOCK_C    0x12
#define CMD_THERMOCOUPLES    0x13

#define NUM_PT100  10
#define NUM_TC     2

#define CH_STATUS_OK              0x00
#define CH_STATUS_HW_UNAVAILABLE  0x01
#define TC_STATUS_OPEN_CIRCUIT    0x01

#define I2C_SDA_PIN  22
#define I2C_SCL_PIN  21
// 50kHz (down from 100kHz) - the TXS0108E's auto-direction sensing has more
// margin against ringing/false-edges at lower speed.
const unsigned long I2C_CLOCK_HZ = 50000UL;

const unsigned long POLL_INTERVAL_MS = 500;   // how often to poll I2C
const unsigned long POST_INTERVAL_MS = 1000;  // how often to POST to the server

// I2C fault-recovery tuning: after this many CONSECUTIVE failures on the
// ATmega path, assume the bus may be wedged and run the recovery sequence.
const uint8_t       I2C_FAIL_RECOVERY_THRESHOLD = 4;
const unsigned long I2C_RECOVERY_MIN_GAP_MS      = 3000UL;

const unsigned long HTTP_TIMEOUT_MS = 3000UL;

SemaphoreHandle_t g_i2cBusMutex;   // protects the shared Wire bus
SemaphoreHandle_t g_dataMutex;     // protects the shared snapshot

// ----------------------------------------------------------------------------
// Shared snapshot (protected by g_dataMutex) - RAW values only, no temperature.
// No RTC fields anymore (v7 uses NTP, read live at POST time).
// ----------------------------------------------------------------------------
struct Pt100Reading { uint16_t raw_mV; uint8_t status; bool valid; };
struct TcReading     { uint16_t raw12; uint8_t status; bool valid; };

struct DashboardData {
  Pt100Reading pt100[NUM_PT100];
  TcReading    tc[NUM_TC];
  uint8_t      atmegaGlobalStatus;
  uint32_t     atmegaUptimeMs;
  bool         atmegaOnline;
  unsigned long lastPollMs;
};

DashboardData g_data;
volatile bool g_timeSynced = false;

// ----------------------------------------------------------------------------
// Small helpers
// ----------------------------------------------------------------------------
uint16_t readU16LE(const uint8_t *b) { return (uint16_t)b[0] | ((uint16_t)b[1] << 8); }
uint32_t readU32LE(const uint8_t *b) {
  return (uint32_t)b[0] | ((uint32_t)b[1] << 8) | ((uint32_t)b[2] << 16) | ((uint32_t)b[3] << 24);
}
uint8_t xorChecksum(const uint8_t *buf, uint8_t len) {
  uint8_t c = 0;
  for (uint8_t i = 0; i < len; i++) c ^= buf[i];
  return c;
}

// ----------------------------------------------------------------------------
// I2C bus recovery (NXP UM10204 "Bus clear" procedure). Still needed for the
// level shifter on the ATmega path - unrelated to the RTC removal.
// ----------------------------------------------------------------------------
void i2cBusRecovery() {
  Serial.println("I2C: running bus recovery sequence...");
  Wire.end();

  pinMode(I2C_SDA_PIN, INPUT_PULLUP);
  pinMode(I2C_SCL_PIN, OUTPUT);
  digitalWrite(I2C_SCL_PIN, HIGH);
  delayMicroseconds(5);

  bool sdaFreed = (digitalRead(I2C_SDA_PIN) == HIGH);
  for (uint8_t i = 0; i < 9 && !sdaFreed; i++) {
    digitalWrite(I2C_SCL_PIN, LOW);
    delayMicroseconds(5);
    digitalWrite(I2C_SCL_PIN, HIGH);
    delayMicroseconds(5);
    if (digitalRead(I2C_SDA_PIN) == HIGH) sdaFreed = true;
  }

  pinMode(I2C_SDA_PIN, OUTPUT);   // manual STOP: SDA low->high while SCL high
  digitalWrite(I2C_SDA_PIN, LOW);
  delayMicroseconds(5);
  digitalWrite(I2C_SCL_PIN, HIGH);
  delayMicroseconds(5);
  digitalWrite(I2C_SDA_PIN, HIGH);
  delayMicroseconds(5);

  Serial.printf("I2C: bus recovery done (SDA %s).\n", sdaFreed ? "released" : "still held - check wiring/pull-ups");
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN, I2C_CLOCK_HZ);
}

bool maybeRecoverBus(uint8_t &consecFailCounter, unsigned long &lastRecoveryMs) {
  if (consecFailCounter < I2C_FAIL_RECOVERY_THRESHOLD) return false;
  unsigned long now = millis();
  if (now - lastRecoveryMs < I2C_RECOVERY_MIN_GAP_MS) return false;

  if (xSemaphoreTake(g_i2cBusMutex, pdMS_TO_TICKS(500)) == pdTRUE) {
    i2cBusRecovery();
    xSemaphoreGive(g_i2cBusMutex);
  }
  lastRecoveryMs = now;
  consecFailCounter = 0;
  return true;
}

uint8_t       g_atmegaConsecFails = 0;
unsigned long g_atmegaLastRecoveryMs = 0;

// Request `len` bytes from the 4808 after selecting `cmd`. Verifies checksum.
// Caller must hold g_i2cBusMutex.
bool readAtmegaBlock(uint8_t cmd, uint8_t *buf, uint8_t len) {
  Wire.beginTransmission(ATMEGA_ADDR);
  Wire.write(cmd);
  if (Wire.endTransmission(false) != 0) return false;

  uint8_t got = Wire.requestFrom((int)ATMEGA_ADDR, (int)len);
  if (got != len) {
    while (Wire.available()) Wire.read();
    return false;
  }
  for (uint8_t i = 0; i < len; i++) buf[i] = Wire.read();

  uint8_t expected = xorChecksum(buf, len - 1);
  if (buf[len - 1] != expected) return false;
  return true;
}

// ----------------------------------------------------------------------------
// Poll the ATmega4808 (4 block reads) into scratch, then commit under mutex.
// ----------------------------------------------------------------------------
void pollAtmega() {
  if (xSemaphoreTake(g_i2cBusMutex, pdMS_TO_TICKS(200)) != pdTRUE) return;

  bool ok = true;
  Pt100Reading pt100Local[NUM_PT100];
  TcReading    tcLocal[NUM_TC];
  uint8_t globalStatus = 0;
  uint32_t uptime = 0;

  uint8_t idBuf[8];
  if (readAtmegaBlock(CMD_ID_STATUS, idBuf, sizeof(idBuf)) && idBuf[0] == 0xA5) {
    globalStatus = idBuf[2];
    uptime = readU32LE(&idBuf[3]);
  } else { ok = false; }

  uint8_t blockA[13];
  if (ok && readAtmegaBlock(CMD_PT100_BLOCK_A, blockA, sizeof(blockA))) {
    for (uint8_t k = 0; k < 4; k++) {
      const uint8_t *p = &blockA[k * 3];
      pt100Local[k].raw_mV = readU16LE(p);
      pt100Local[k].status = p[2];
      pt100Local[k].valid = true;
    }
  } else { ok = false; }

  uint8_t blockB[13];
  if (ok && readAtmegaBlock(CMD_PT100_BLOCK_B, blockB, sizeof(blockB))) {
    for (uint8_t k = 0; k < 4; k++) {
      const uint8_t *p = &blockB[k * 3];
      pt100Local[4 + k].raw_mV = readU16LE(p);
      pt100Local[4 + k].status = p[2];
      pt100Local[4 + k].valid = true;
    }
  } else { ok = false; }

  uint8_t blockC[7];
  if (ok && readAtmegaBlock(CMD_PT100_BLOCK_C, blockC, sizeof(blockC))) {
    for (uint8_t k = 0; k < 2; k++) {
      const uint8_t *p = &blockC[k * 3];
      pt100Local[8 + k].raw_mV = readU16LE(p);
      pt100Local[8 + k].status = p[2];
      pt100Local[8 + k].valid = true;
    }
  } else { ok = false; }

  uint8_t blockTc[7];
  if (ok && readAtmegaBlock(CMD_THERMOCOUPLES, blockTc, sizeof(blockTc))) {
    for (uint8_t t = 0; t < NUM_TC; t++) {
      const uint8_t *p = &blockTc[t * 3];
      tcLocal[t].raw12 = readU16LE(p);
      tcLocal[t].status = p[2];
      tcLocal[t].valid = true;
    }
  } else { ok = false; }

  xSemaphoreGive(g_i2cBusMutex);

  g_atmegaConsecFails = ok ? 0 : (g_atmegaConsecFails + 1);
  maybeRecoverBus(g_atmegaConsecFails, g_atmegaLastRecoveryMs);

  if (xSemaphoreTake(g_dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
    g_data.atmegaOnline = ok;
    if (ok) {
      memcpy(g_data.pt100, pt100Local, sizeof(pt100Local));
      memcpy(g_data.tc, tcLocal, sizeof(tcLocal));
      g_data.atmegaGlobalStatus = globalStatus;
      g_data.atmegaUptimeMs = uptime;
    }
    g_data.lastPollMs = millis();
    xSemaphoreGive(g_dataMutex);
  }
}

// ----------------------------------------------------------------------------
// Background I2C polling task (core 0) - ATmega only, no RTC.
// ----------------------------------------------------------------------------
void i2cPollTask(void *pv) {
  i2cBusRecovery(); // cheap insurance in case the bus came up in a bad state
  for (;;) {
    pollAtmega();
    vTaskDelay(pdMS_TO_TICKS(POLL_INTERVAL_MS));
  }
}

// ----------------------------------------------------------------------------
// NTP time. configTime() starts SNTP, which then keeps the ESP32's system
// clock synced automatically (periodic re-sync) as long as WiFi is up.
// ----------------------------------------------------------------------------
void startNtp() {
  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER_1, NTP_SERVER_2, NTP_SERVER_3);
  Serial.print("NTP: syncing time");
  struct tm timeinfo;
  unsigned long start = millis();
  while (!getLocalTime(&timeinfo, 500) && millis() - start < 15000) {
    Serial.print(".");
  }
  Serial.println();
  if (getLocalTime(&timeinfo, 500)) {
    g_timeSynced = true;
    char buf[32];
    strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", &timeinfo);
    Serial.printf("NTP: time synced -> %s\n", buf);
  } else {
    g_timeSynced = false;
    Serial.println("NTP: initial sync failed - will keep trying in background.");
  }
}

// Fill time/date strings + epoch from the NTP-synced system clock.
// Returns true if a valid time is available.
bool getNowStrings(char *timeStr, size_t timeLen, char *dateStr, size_t dateLen, uint32_t &epochOut) {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo, 100)) return false;
  strftime(timeStr, timeLen, "%H:%M:%S", &timeinfo);
  strftime(dateStr, dateLen, "%Y-%m-%d", &timeinfo);
  epochOut = (uint32_t)mktime(&timeinfo);
  return true;
}

// ----------------------------------------------------------------------------
// HTTP: build the raw-data JSON payload and POST it. Timestamp comes from NTP.
// ----------------------------------------------------------------------------
bool postSnapshotToServer(const DashboardData &snap) {
  if (WiFi.status() != WL_CONNECTED) return false;

  JsonDocument doc;
  doc["device_id"] = DEVICE_ID;
  doc["atmega_online"] = snap.atmegaOnline;
  doc["atmega_status"] = snap.atmegaGlobalStatus;
  doc["atmega_uptime_ms"] = snap.atmegaUptimeMs;
  doc["esp_uptime_ms"] = millis();

  // NTP timestamp (top-level - the server prefers these over its own clock).
  char timeStr[16], dateStr[16];
  uint32_t epoch = 0;
  bool timeValid = getNowStrings(timeStr, sizeof(timeStr), dateStr, sizeof(dateStr), epoch);
  doc["time_valid"] = timeValid;
  if (timeValid) {
    doc["time"]  = timeStr;   // "HH:MM:SS"
    doc["date"]  = dateStr;   // "YYYY-MM-DD"
    doc["epoch"] = epoch;     // unix seconds (local-adjusted)
  }

  JsonArray pt100 = doc["pt100"].to<JsonArray>();
  for (uint8_t i = 0; i < NUM_PT100; i++) {
    JsonObject ch = pt100.add<JsonObject>();
    ch["ch"] = i + 1;
    ch["raw_mV"] = snap.pt100[i].raw_mV;
    ch["status"] = snap.pt100[i].status;
    ch["hw_available"] = (snap.pt100[i].status != CH_STATUS_HW_UNAVAILABLE);
    ch["valid"] = snap.pt100[i].valid;
  }

  JsonArray tc = doc["tc"].to<JsonArray>();
  for (uint8_t i = 0; i < NUM_TC; i++) {
    JsonObject c = tc.add<JsonObject>();
    c["ch"] = i + 1;
    c["raw12"] = snap.tc[i].raw12;
    c["fault"] = (snap.tc[i].status == TC_STATUS_OPEN_CIRCUIT);
    c["valid"] = snap.tc[i].valid;
  }

  String body;
  serializeJson(doc, body);

  // Pick a plain or TLS client based on the URL scheme. For HTTPS we use
  // setInsecure() (skip certificate validation) - simplest and fine for
  // posting sensor data; the payload is still encrypted in transit.
  bool isHttps = (strncmp(SERVER_URL, "https", 5) == 0);
  WiFiClient plainClient;
  WiFiClientSecure secureClient;
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);

  bool began;
  if (isHttps) {
    secureClient.setInsecure();
    began = http.begin(secureClient, SERVER_URL);
  } else {
    began = http.begin(plainClient, SERVER_URL);
  }
  if (!began) return false;

  http.addHeader("Content-Type", "application/json");
  if (strlen(DEVICE_API_KEY) > 0) http.addHeader("X-Device-Key", DEVICE_API_KEY);

  int code = http.POST(body);
  http.end();

  if (code < 200 || code >= 300) {
    Serial.printf("HTTP POST failed, code=%d\n", code);
    return false;
  }
  return true;
}

// ----------------------------------------------------------------------------
// WiFi
// ----------------------------------------------------------------------------
void setupWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi connected, IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi FAILED to connect - will keep retrying in background.");
  }
}

void ensureWifi() {
  static unsigned long lastAttempt = 0;
  if (WiFi.status() != WL_CONNECTED && millis() - lastAttempt > 10000) {
    lastAttempt = millis();
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }
}

void setup() {
  Serial.begin(115200);
  memset(&g_data, 0, sizeof(g_data));
  g_dataMutex = xSemaphoreCreateMutex();
  g_i2cBusMutex = xSemaphoreCreateMutex();

  setupWifi();
  if (WiFi.status() == WL_CONNECTED) startNtp();

  xTaskCreatePinnedToCore(i2cPollTask, "i2cPoll", 6144, NULL, 1, NULL, 0);
}

void loop() {
  static unsigned long lastPost = 0;
  static bool ntpStartedOnce = (false);
  ensureWifi();

  // If WiFi came up after boot (or reconnected) and we never synced, start NTP.
  if (WiFi.status() == WL_CONNECTED && !g_timeSynced) {
    static unsigned long lastNtpTry = 0;
    if (millis() - lastNtpTry > 10000) {
      lastNtpTry = millis();
      startNtp();
    }
  }

  unsigned long now = millis();
  if (now - lastPost >= POST_INTERVAL_MS) {
    lastPost = now;
    DashboardData snap;
    if (xSemaphoreTake(g_dataMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
      snap = g_data;
      xSemaphoreGive(g_dataMutex);
    }
    postSnapshotToServer(snap);
  }

  delay(10);
}
