'use strict';

// Master-calibration logic (architecture doc §6), written as pure functions so
// the tricky "clear doesn't touch calculated" / "formula edit shifts master"
// behaviors are testable in isolation.

// Compute the error factor at calibration time: reference minus current calculated.
//   error_factor = M_ref - C_now
function computeErrorFactor(referenceC, calculatedNowC) {
  return referenceC - calculatedNowC;
}

// Given a fresh calculated value and the channel's current master state, derive
// the live master value. master = calculated + error_factor, only when enabled.
// Returns { masterTempC, errorFactorAtTime } — both null when master disabled.
function applyCalibration(calculatedTempC, channelConfig) {
  const enabled = !!channelConfig.master_enabled;
  const ef = channelConfig.master_error_factor;
  if (!enabled || ef == null || calculatedTempC == null) {
    return { masterTempC: null, errorFactorAtTime: null };
  }
  return {
    masterTempC: calculatedTempC + ef,
    errorFactorAtTime: ef,
  };
}

module.exports = {
  computeErrorFactor,
  applyCalibration,
};
