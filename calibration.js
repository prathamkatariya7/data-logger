'use strict';

/**
 * @module calibration
 * @description Master-calibration offset evaluation functions.
 * Computes reference offset error factors and applies offset calibration to raw calculated temperature values.
 */

/**
 * Computes calibration error factor offset: reference minus current calculated value.
 * 
 * @param {number} referenceC - Reference standard temperature in °C
 * @param {number} calculatedNowC - Uncalibrated calculated temperature in °C
 * @returns {number} Computed offset error factor
 */
function computeErrorFactor(referenceC, calculatedNowC) {
  return referenceC - calculatedNowC;
}

/**
 * Applies master-calibration error factor to a calculated temperature reading.
 * 
 * @param {number|null} calculatedTempC - Uncalibrated calculated temperature
 * @param {Object} channelConfig - Channel configuration object containing master calibration flags
 * @returns {{masterTempC: number|null, errorFactorAtTime: number|null}} Master calibrated output and offset snapshot
 */
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
