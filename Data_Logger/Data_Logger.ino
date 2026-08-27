/* ============================================================================
 *  ATmega4808 Sensor Node  -  I2C SLAVE firmware   (v4)
 *  PT100 (x10, bridge-conditioned) + MAX6675 K-type thermocouple (x2)
 *  Reports RAW measured values ONLY over I2C to the ESP32 master:
 *    - PT100: the amplified analog voltage present at the GPIO/ADC pin, in
 *      millivolts (this is a direct pin measurement, not a temperature).
 *    - Thermocouple: the raw 12-bit code read straight off the MAX6675 over
 *      SPI (again, not a temperature).
 *
 *  CHANGE IN v4 - ARCHITECTURE CHANGE, per new system design:
 *    All temperature-conversion math (the PT100 bridge model and the MAX6675
 *    0.25 C/count scaling) has been REMOVED from this firmware. This chip's
 *    only job now is: sample the ADC / read the MAX6675 over SPI, and hand
 *    the raw measured values to the ESP32 over I2C. The ESP32 forwards them
 *    unmodified to a server, which is the ONLY place any C-degrees value is
 *    ever computed. See mfb_server/README.md for the exact formulas (they
 *    are unchanged from this firmware's old v2/v3 math - RA=RC=4700 ohm,
 *    R0=100 ohm, ALPHA=0.39, gain=10, MAX6675 = raw12 * 0.25 C/count - only
 *    *where* they run has moved).
 *
 *  This firmware still keeps the v3 measurement-quality fixes, since those
 *  affect the raw_mV value itself (not a temperature conversion):
 *    - readAdcAveraged(): dummy conversion + ~20us settle after switching
 *      ADC channel/pin, to avoid AVR ADC S&H "crosstalk" between channels
 *      (Atmel app note AVR125).
 *    - Persistent per-channel EMA filter (g_pt100FilterState /
 *      PT100_FILTER_ALPHA) so raw_mV settles like a bench multimeter
 *      reading instead of jittering every 200ms sample cycle.
 * ----------------------------------------------------------------------------
 *  BOARD / TOOLCHAIN
 *    Arduino IDE + MegaCoreX (https://github.com/MCUdude/MegaCoreX)
 *    Board:  ATmega4808   Pinout: "Standard pinout" (PIN_PAx/PIN_PCx/PIN_PDx/
 *            PIN_PFx macros as shipped by MegaCoreX's variant file)
 *    Clock:  internal, whatever your MFB Gen3 fuses use (16/20 MHz) - doesn't
 *            affect this code, only affects Serial baud accuracy if you add
 *            debug prints.
 *    BOD/Vref: ADC reference is set to VDD (5V) in setup(). The server-side
 *            conversion assumes this pin voltage was sampled against a clean
 *            5.00V rail - if your VCC_5V is off, either fix the rail or tell
 *            the server team the actual measured VDC so they can update the
 *            constant on their side (NOT here - see v4 note above).
 * ----------------------------------------------------------------------------
 *  PIN MAP (from schematic "ATMEGA4808" sheet) - unchanged from v3
 *    TWI0 (I2C slave, hardware)      SDA=PA2 (SDA_0)   SCL=PA3 (SCL_0)
 *    SPI0 (MAX6675, hardware)        MISO=PA5  SCK=PA6  MOSI=PA4 (N/C, unused)
 *    MAX6675 #1 chip-select          CS1 = PA7
 *    MAX6675 #2 chip-select          CS2 = PC3
 *    PT100 bridge outputs 1-8        PD0, PD1, PD2, PD3, PD4, PD5, PD6, PD7
 *    PT100 bridge outputs 9-10       PF5, PF4   <-- see HARDWARE NOTE below
 *
 *  !!!!!!!!!!!!!!!!!!!!!!!!!!!! HARDWARE NOTE !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 *  On the 32-pin ATmega4808 package, ADC0's analog inputs (AIN0-AIN7) only
 *  exist on PORTD. PORTE (which would carry AIN8-AIN11) is not present on
 *  this package, and PF4/PF5 have no ADC mux path at all - they are digital
 *  I/O only. As wired, PT100_9 (PF5) and PT100_10 (PF4) CANNOT be sampled by
 *  the internal ADC.
 *
 *  This firmware still reserves the two channels in the I2C data structure
 *  (so the protocol/format doesn't change later) but reports them with
 *  status = CH_STATUS_HW_UNAVAILABLE and raw_mV = 0, instead of fabricating
 *  a number from a pin that isn't actually an ADC input. Fix options for
 *  later: move these two nets to an unused PORTD pin pair (only 8 exist
 *  total, so something else has to move off PORTD), or add an external
 *  I2C/SPI ADC (e.g. ADS1115) on the same bus - see
 *  I2C_Protocol_and_Wiring_Notes.md.
 *  !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 *
 *  "RAW" VALUE DEFINITION - IMPORTANT (unchanged meaning from v3, this is
 *  still not the ADC's digital code)
 *    The value reported over I2C as "raw" for each PT100 channel is the
 *    amplified analog signal actually present at the ATmega4808's GPIO/ADC
 *    pin, expressed in millivolts (uint16_t, 0-5000 range):
 *        raw_mV = round( (adcCode / 1023) * VDC * 1000 )
 *    where VDC is the ADC reference / bridge excitation voltage (nominally
 *    5.00V - see BOD/Vref note above). This firmware still samples the
 *    10-bit ADC internally (that's the only way to *measure* the pin
 *    voltage) but stops there - it does NOT turn that voltage into a
 *    temperature. That conversion, and the bridge math constants (RA, RC,
 *    R0, R1, RF, ALPHA), now live entirely on the server - see
 *    mfb_server/README.md.
 * ============================================================================
 */

#include <Wire.h>
#include <SPI.h>
#include <avr/wdt.h>

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------
#define I2C_SLAVE_ADDR      0x30      // pick something free on your bus (DS1307=0x68)
#define FW_VERSION          0x04
#define NUM_PT100           10
#define NUM_TC               2
#define SAMPLE_INTERVAL_MS  200UL
#define ADC_OVERSAMPLES       8       // software averaging for noise reduction

// ADC reference / bridge excitation voltage, in volts. NOT used for any
// temperature math here (that's server-side) - only used to turn the raw
// 10-bit ADC code into a millivolt value at the pin. Verify against your
// actual VCC_5V rail with a multimeter; if it's off, update it here (this is
// a hardware measurement fact about THIS board, not a calibration constant).
static const float VDC   = 5.0f;
static const uint16_t ADC_MAX = 1023; // 10-bit

// PT100 channel -> pin. Channels 9/10 (index 8,9) are NOT real ADC pins - see
// HARDWARE NOTE above. Kept here so the mapping matches the schematic 1:1.
const uint8_t PT100_PIN[NUM_PT100] = {
  PIN_PD0, PIN_PD1, PIN_PD2, PIN_PD3, PIN_PD4, PIN_PD5, PIN_PD6, PIN_PD7, // ch1-8 (valid ADC)
  PIN_PF5, PIN_PF4                                                        // ch9-10 (NOT ADC-capable)
};
const bool PT100_ADC_CAPABLE[NUM_PT100] = {
  true, true, true, true, true, true, true, true, false, false
};

#define CS1_PIN PIN_PA7
#define CS2_PIN PIN_PC3
const uint8_t TC_CS_PIN[NUM_TC] = { CS1_PIN, CS2_PIN };

// Per-channel status bits (sent in each block's status/fault byte)
#define CH_STATUS_OK              0x00
#define CH_STATUS_HW_UNAVAILABLE  0x01   // physically can't be sampled (see note)
#define TC_STATUS_OK               0x00
#define TC_STATUS_OPEN_CIRCUIT      0x01

// I2C command / register bytes the ESP32 (master) selects before a read
#define CMD_ID_STATUS       0x00   // 8 bytes - who-am-i / firmware / uptime / global status
#define CMD_PT100_BLOCK_A    0x10   // 13 bytes - PT100 ch 1-4  (raw_mV + status per ch)
#define CMD_PT100_BLOCK_B    0x11   // 13 bytes - PT100 ch 5-8
#define CMD_PT100_BLOCK_C    0x12   //  7 bytes - PT100 ch 9-10 (flagged unavailable)
#define CMD_THERMOCOUPLES    0x13   //  7 bytes - TC1 + TC2 (raw12 + status per ch)

// ----------------------------------------------------------------------------
// Live sensor data (updated by sampleAllSensors() in loop(), served to the
// I2C ISR from a snapshot so requestEvent() never blocks / never touches
// ADC or SPI directly - critical for I2C slave timing correctness).
// Note: NO temperature fields here anymore - raw values only.
// ----------------------------------------------------------------------------
struct Pt100Channel {
  uint16_t raw_mV;      // amplified analog voltage AT THE GPIO PIN, in millivolts
                         // (0 if HW_UNAVAILABLE) - NOT a digital ADC code, and NOT a temperature
  uint8_t  status;
};

struct TcChannel {
  uint16_t raw12;       // raw 12-bit MAX6675 code - NOT a temperature
  uint8_t  status;
};

volatile uint8_t  g_i2cCommand = CMD_ID_STATUS;

Pt100Channel g_pt100[NUM_PT100];
TcChannel    g_tc[NUM_TC];
uint8_t      g_globalStatus = 0;     // bit0 = ADC subsystem ok, bit1/2 = TC1/TC2 fault
uint32_t     g_uptimeMs = 0;

// ----------------------------------------------------------------------------
// Software low-pass filter (exponential moving average), one instance per
// PT100 channel, persisting across sample cycles.
//
// WHY THIS EXISTS: a bench multimeter's displayed reading is itself a
// heavily time-averaged view of the same electrically-noisy node - its own
// ADC integrates over many milliseconds before it shows you a number. This
// firmware's 8-sample oversampling in readAdcAveraged() only spans ~0.3ms
// total, so it doesn't reject anything slower than that (SMPS switching
// ripple envelope, digital I/O switching transients, etc.) - that's why the
// multimeter looked rock-stable while a naive readout would jitter on the
// exact same node. This filter integrates across many 200ms sample cycles
// instead of within one, which is what actually reproduces DMM-like
// stability. This is still a raw-voltage-quality concern, not a temperature
// conversion, so it stays here.
//
// PT100_FILTER_ALPHA trades responsiveness for smoothness (0 < alpha <= 1).
// Thermal mass means real temperature can't change fast, so a slow filter
// costs nothing in practice. Lower = smoother/slower; 1.0 = filter disabled.
// ----------------------------------------------------------------------------
const float PT100_FILTER_ALPHA = 0.15f;
float g_pt100FilterState[NUM_PT100];
bool  g_pt100FilterInit[NUM_PT100] = {false};

// ----------------------------------------------------------------------------
// raw 10-bit ADC code -> the actual analog voltage present at the GPIO pin,
// in millivolts. This is what gets reported as "raw" over I2C. This is a
// unit conversion of a direct pin measurement (counts -> mV), NOT a
// temperature calculation - the bridge/temperature math lives server-side.
// ----------------------------------------------------------------------------
uint16_t adcToMillivolts(uint16_t adcRaw) {
  float mv = ((float)adcRaw / (float)ADC_MAX) * VDC * 1000.0f;
  return (uint16_t)(mv + 0.5f); // round to nearest mV
}

// Reads pin with proper channel-switch settling: the AVR ADC's S&H
// capacitor can carry a small residual charge from whichever channel was
// sampled just before this one ("crosstalk" - documented in Atmel's own
// AVR125 app note: "the first next conversion from a changed input may not
// be accurate"). Since sampleAllSensors() walks PD0->PD7 back-to-back every
// cycle, every channel was picking up a bit of its neighbor's voltage.
// Fix: throw away one conversion right after switching pins, and give the
// S&H node a few microseconds to settle before the real (averaged) reads.
uint16_t readAdcAveraged(uint8_t pin) {
  analogRead(pin);          // dummy conversion: flushes the stale S&H sample
  delayMicroseconds(20);    // let the S&H capacitor settle to the new channel
  uint32_t acc = 0;
  for (uint8_t i = 0; i < ADC_OVERSAMPLES; i++) {
    acc += analogRead(pin);
    delayMicroseconds(20);  // spread samples out a little instead of one burst,
                             // so they don't all land on the same noise instant
  }
  return (uint16_t)(acc / ADC_OVERSAMPLES);
}

// ----------------------------------------------------------------------------
// MAX6675 (K-type thermocouple), hardware SPI0, read-only, 16-bit frame:
//   D15       = 0 (dummy sign bit)
//   D14..D3   = 12-bit raw code (server converts to C at 0.25 C / count)
//   D2        = 1 -> thermocouple input open (fault)
//   D1        = device ID (unused)
//   D0        = tri-state (unused)
// This firmware only extracts the raw 12-bit code and the fault bit - it
// does NOT scale the code to degrees C (that's server-side, see v4 note).
// ----------------------------------------------------------------------------
void readMAX6675(uint8_t csPin, uint16_t &raw12Out, bool &faultOut) {
  digitalWrite(csPin, LOW);
  delayMicroseconds(5);   // t_CSS per MAX6675 datasheet
  SPI.beginTransaction(SPISettings(4000000UL, MSBFIRST, SPI_MODE0));
  uint16_t v = SPI.transfer16(0x0000);
  SPI.endTransaction();
  delayMicroseconds(2);
  digitalWrite(csPin, HIGH);

  faultOut = (v & 0x0004) != 0;
  raw12Out = (v >> 3) & 0x0FFF;
}

// ----------------------------------------------------------------------------
// Sampling - called from loop() only, never from an I2C ISR context
// ----------------------------------------------------------------------------
void sampleAllSensors() {
  uint8_t globalStatus = 0x01; // bit0: ADC subsystem alive (we got this far)

  for (uint8_t ch = 0; ch < NUM_PT100; ch++) {
    if (!PT100_ADC_CAPABLE[ch]) {
      g_pt100[ch].raw_mV = 0;
      g_pt100[ch].status = CH_STATUS_HW_UNAVAILABLE;
      continue;
    }
    uint16_t adcCode = readAdcAveraged(PT100_PIN[ch]);
    uint16_t rawMvInstant = adcToMillivolts(adcCode);

    // Apply the persistent EMA filter (see g_pt100FilterState comment above)
    // so raw_mV settles down like a multimeter reading instead of jittering
    // every 200ms.
    if (!g_pt100FilterInit[ch]) {
      g_pt100FilterState[ch] = (float)rawMvInstant; // seed on first sample, no lag
      g_pt100FilterInit[ch] = true;
    } else {
      g_pt100FilterState[ch] += PT100_FILTER_ALPHA * ((float)rawMvInstant - g_pt100FilterState[ch]);
    }

    g_pt100[ch].raw_mV = (uint16_t)(g_pt100FilterState[ch] + 0.5f);
    g_pt100[ch].status = CH_STATUS_OK;
  }

  for (uint8_t t = 0; t < NUM_TC; t++) {
    uint16_t raw12; bool fault;
    readMAX6675(TC_CS_PIN[t], raw12, fault);
    g_tc[t].raw12 = raw12;
    g_tc[t].status = fault ? TC_STATUS_OPEN_CIRCUIT : TC_STATUS_OK;
    if (fault) globalStatus |= (1 << (t + 1));
  }

  g_globalStatus = globalStatus;
  g_uptimeMs = millis();
}

// ----------------------------------------------------------------------------
// I2C block serializers - fast, no blocking calls, just packing bytes.
// Each block ends with a 1-byte XOR checksum of everything before it so the
// master can detect a torn/garbled read on this shared, level-shifted bus.
// ----------------------------------------------------------------------------
void writeU16LE(uint8_t *buf, uint8_t &idx, uint16_t v) {
  buf[idx++] = (uint8_t)(v & 0xFF);
  buf[idx++] = (uint8_t)((v >> 8) & 0xFF);
}
void writeU32LE(uint8_t *buf, uint8_t &idx, uint32_t v) {
  buf[idx++] = (uint8_t)(v & 0xFF);
  buf[idx++] = (uint8_t)((v >> 8) & 0xFF);
  buf[idx++] = (uint8_t)((v >> 16) & 0xFF);
  buf[idx++] = (uint8_t)((v >> 24) & 0xFF);
}
uint8_t xorChecksum(const uint8_t *buf, uint8_t len) {
  uint8_t c = 0;
  for (uint8_t i = 0; i < len; i++) c ^= buf[i];
  return c;
}

void sendIdStatusBlock() {
  uint8_t buf[8]; uint8_t i = 0;
  buf[i++] = 0xA5;               // magic / who-am-i
  buf[i++] = FW_VERSION;
  buf[i++] = g_globalStatus;
  writeU32LE(buf, i, g_uptimeMs);
  buf[i] = xorChecksum(buf, i); i++;
  Wire.write(buf, i);
}

// startCh..startCh+3, 4 channels, raw_mV(2)+status(1) = 3 bytes/ch + checksum = 13 bytes
void sendPt100Block(uint8_t startCh) {
  uint8_t buf[13]; uint8_t i = 0;
  for (uint8_t k = 0; k < 4; k++) {
    Pt100Channel &c = g_pt100[startCh + k];
    writeU16LE(buf, i, c.raw_mV);
    buf[i++] = c.status;
  }
  buf[i] = xorChecksum(buf, i); i++;
  Wire.write(buf, i);
}

// channels 9-10 only (2 channels instead of 4): 2*3 + checksum = 7 bytes
void sendPt100BlockC() {
  uint8_t buf[7]; uint8_t i = 0;
  for (uint8_t k = 8; k < 10; k++) {
    Pt100Channel &c = g_pt100[k];
    writeU16LE(buf, i, c.raw_mV);
    buf[i++] = c.status;
  }
  buf[i] = xorChecksum(buf, i); i++;
  Wire.write(buf, i);
}

// raw12(2)+status(1) = 3 bytes/ch, 2 channels + checksum = 7 bytes
void sendThermocoupleBlock() {
  uint8_t buf[7]; uint8_t i = 0;
  for (uint8_t t = 0; t < NUM_TC; t++) {
    writeU16LE(buf, i, g_tc[t].raw12);
    buf[i++] = g_tc[t].status;
  }
  buf[i] = xorChecksum(buf, i); i++;
  Wire.write(buf, i);
}

// ----------------------------------------------------------------------------
// I2C slave callbacks
// ----------------------------------------------------------------------------
void receiveEvent(int numBytes) {
  if (Wire.available()) {
    g_i2cCommand = Wire.read();
  }
  while (Wire.available()) Wire.read(); // flush anything extra
}

void requestEvent() {
  switch (g_i2cCommand) {
    case CMD_PT100_BLOCK_A:  sendPt100Block(0); break;
    case CMD_PT100_BLOCK_B:  sendPt100Block(4); break;
    case CMD_PT100_BLOCK_C:  sendPt100BlockC(); break;
    case CMD_THERMOCOUPLES:  sendThermocoupleBlock(); break;
    case CMD_ID_STATUS:
    default:                 sendIdStatusBlock(); break;
  }
}

// ----------------------------------------------------------------------------
// Setup / loop
// ----------------------------------------------------------------------------
void setup() {
  analogReference(VDD);        // ADC Vref = VDD = bridge Vdc -> raw_mV is ratiometric to this
  analogReadResolution(10);

  for (uint8_t ch = 0; ch < NUM_PT100; ch++) {
    if (PT100_ADC_CAPABLE[ch]) pinMode(PT100_PIN[ch], INPUT);
  }

  pinMode(CS1_PIN, OUTPUT); digitalWrite(CS1_PIN, HIGH);
  pinMode(CS2_PIN, OUTPUT); digitalWrite(CS2_PIN, HIGH);
  SPI.begin();

  Wire.begin(I2C_SLAVE_ADDR);
  Wire.onReceive(receiveEvent);
  Wire.onRequest(requestEvent);

  sampleAllSensors(); // populate before the first I2C poll can arrive

  wdt_enable(WDTO_2S); // production safety net - reset if loop() ever hangs
}

void loop() {
  static unsigned long lastSample = 0;
  wdt_reset();

  unsigned long now = millis();
  if (now - lastSample >= SAMPLE_INTERVAL_MS) {
    lastSample = now;
    sampleAllSensors();
  }
}
