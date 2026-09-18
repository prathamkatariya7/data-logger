'use strict';

/**
 * @module temperature
 * @description Parameterized temperature conversion physics formulas for PT100 RTD and MAX6675 Thermocouple sensors.
 */

/**
 * Converts raw millivolts reading from PT100 Wheatstone bridge circuit to temperature in Celsius.
 * 
 * @param {number} raw_mV - Raw millivolt measurement
 * @param {Object} params - PT100 formula parameters (R0, RA, RC, R1, RF, VDC, ALPHA)
 * @returns {number} Temperature in °C
 */
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

/**
 * Converts raw 12-bit ADC count from Thermocouple interface to temperature in Celsius.
 * 
 * @param {number} raw12 - Raw 12-bit ADC value
 * @param {Object} params - Thermocouple formula parameters (slope)
 * @returns {number} Temperature in °C
 */
function tcRaw12ToCelsius(raw12, params) {
  const { slope } = params;
  return raw12 * slope;
}

/**
 * Dispatches raw sensor reading to appropriate temperature conversion formula by channel type.
 * 
 * @param {string} channelType - Sensor channel type ('pt100' or 'tc')
 * @param {number|null} rawValue - Raw sensor measurement
 * @param {Object} formulaParams - Parameter dictionary for conversion formula
 * @returns {number|null} Calculated temperature in °C or null if invalid
 */
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
