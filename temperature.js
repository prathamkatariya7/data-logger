'use strict';

// Config-driven temperature conversion (architecture doc §5).
// Same physics as the original firmware/README — only the constants now come
// from per-channel formula_params instead of module-level constants.

function pt100MillivoltsToCelsius(raw_mV, params) {
  const { R0, RA, RC, R1, RF, VDC, ALPHA } = params;
  const GAIN = RF / R1;
  const Vout = raw_mV / 1000;
  const Vdiff = Vout / GAIN;
  const VB_REF = (VDC * R0) / (RA + R0);
  const Va = Vdiff + VB_REF;
  const RTD = (Va * RC) / (VDC - Va);
  return (RTD - R0) / ALPHA;
}

function tcRaw12ToCelsius(raw12, params) {
  const { slope } = params;
  return raw12 * slope; // slope defaults to 0.25 per MAX6675 datasheet
}

// Dispatch by channel type. Returns a number (may be NaN if inputs are bad).
function calculateTemp(channelType, rawValue, formulaParams) {
  if (rawValue == null || Number.isNaN(rawValue)) return null;
  const t =
    channelType === 'pt100'
      ? pt100MillivoltsToCelsius(rawValue, formulaParams)
      : tcRaw12ToCelsius(rawValue, formulaParams);
  return Number.isFinite(t) ? t : null;
}

module.exports = {
  pt100MillivoltsToCelsius,
  tcRaw12ToCelsius,
  calculateTemp,
};
