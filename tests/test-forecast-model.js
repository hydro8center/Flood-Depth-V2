'use strict';

const assert = require('node:assert/strict');
const config = require('../data/forecast-model.json');
const rating = require('../data/rating-tables.json');
const unitHydrograph = require('../data/x90-unit-hydrograph.json');
const unitHydrograph174 = require('../data/x174-unit-hydrograph.json');
const model = require('../forecast-model.js');

model.validateConfig(config);
assert.equal(config.schema, 2);
assert.equal(config.method, 'direct_horizon_ridge_regression');

const representative = model.directForecast(config, {
  q173: 100,
  q90: 150,
  apiOrigin: 50,
  rainPast2: 5,
  rainPast1: 10,
  rainPast0: 20,
  rainFcst1: 30,
  rainFcst2: 40,
  rainFcst3: 50
});

assert.deepEqual(
  representative.horizons.map(row => [row.q_x173a_cms, row.q_x90_cms]),
  [[99.205, 151.393], [101.27, 159.463], [115.394, 191.289]]
);
assert.deepEqual(representative.inputs.rain_past_mm, [5, 10, 20]);
assert.deepEqual(representative.inputs.rain_forecast_mm, [30, 40, 50]);
assert.deepEqual(representative.horizons.map(row => row.forecast_rain_mm), [30, 40, 50]);
assert.ok(representative.horizons.every(row => row.persistence_x173a_cms === 100));
assert.ok(representative.horizons.every(row => row.persistence_x90_cms === 150));

const dryZero = model.directForecast(config, {
  q173: 0, q90: 0, apiOrigin: 0,
  rainPast2: 0, rainPast1: 0, rainPast0: 0,
  rainFcst1: 0, rainFcst2: 0, rainFcst3: 0
});
assert.ok(dryZero.horizons.every(row => row.q_x173a_cms === 0 && row.q_x90_cms === 0));

assert.throws(() => model.directForecast(config, {
  q173: -1, q90: 0, apiOrigin: 0,
  rainPast2: 0, rainPast1: 0, rainPast0: 0,
  rainFcst1: 0, rainFcst2: 0, rainFcst3: 0
}), /q173/);

assert.equal(config.reported_validation['X.90']['3'].nse, 0.631171);
assert.equal(config.reported_validation['X.173A']['1'].rmse_m3s, 6.506432);

model.validateRatingConfig(rating);
assert.equal(model.stageToDischarge(rating, 'X.90', 2.93), 46.5);
assert.equal(model.stageToDischarge(rating, 'X.90', 2.935), 46.75);
assert.equal(model.stageToDischarge(rating, 'X.173A', 9.4), 0);
assert.equal(model.stageToDischarge(rating, 'X.173A', 18), 1950);
assert.equal(model.stageToDischarge(rating, 'X.173A', 9.39), null);
assert.equal(model.stageToDischarge(rating, 'X.90', 13.06), null);
assert.equal(model.dailyVolumeMcm(100), 8.64);
assert.equal(model.hourlyVolumeMcm(100), 0.36);
const hourly = model.expandHourlyForecast(representative);
assert.equal(hourly.length, 72);
assert.equal(hourly[0].q_x173a_cms, representative.horizons[0].q_x173a_cms);
assert.equal(hourly[23].horizon_day, 1);
assert.equal(hourly[24].horizon_day, 2);
assert.equal(hourly[71].horizon_day, 3);
assert.equal(Number((hourly.slice(0, 24).reduce((sum, row) => sum + row.volume_x173a_mcm_hour, 0)).toFixed(6)),
  model.dailyVolumeMcm(representative.horizons[0].q_x173a_cms));

model.validateUnitHydrographConfig(unitHydrograph);
assert.equal(unitHydrograph.rain_stations.length, 7);
assert.equal(unitHydrograph.unit_hydrograph.peak_hour, 65);
const uhDry = model.unitHydrographForecast(unitHydrograph, {
  baseflowCms: 10,
  runoffCoefficient: 0.2,
  rainByDay: Array.from({length:6}, () => Array(7).fill(0))
});
assert.equal(uhDry.hourly.length, 72);
assert.ok(uhDry.daily.every(row => row.volume_mcm_day === 0.864));
assert.ok(uhDry.daily.every(row => row.mean_q_cms === 10 && row.peak_q_cms === 10));
const uhRain = model.unitHydrographForecast(unitHydrograph, {
  baseflowCms: 0,
  runoffCoefficient: 0.2,
  rainByDay: [
    Array(7).fill(0), Array(7).fill(0), Array(7).fill(10),
    Array(7).fill(0), Array(7).fill(0), Array(7).fill(0)
  ]
});
assert.equal(uhRain.basin_rain_mm[2], 10);
assert.equal(uhRain.effective_rain_mm[2], 2);
assert.equal(uhRain.input_response_volume_mcm, 3.06862);
assert.ok(uhRain.daily[0].volume_mcm_day > 0);
assert.equal(Number(uhRain.hourly.reduce((sum,row)=>sum+row.total_volume_mcm_hour,0).toFixed(6)),
  Number(uhRain.daily.reduce((sum,row)=>sum+row.volume_mcm_day,0).toFixed(6)));

const observedExtremeStationRain = [
  [155, 46.8, 370.2, 139.6, 143.8, 262],
  [74, 14, 173.6, 158, 262, 272],
  [10, 7, 68, 45, 173, 156],
  [11, 10, 61, 51, 236, 134],
  [87.5, 58, 183, 79, 84, 210],
  [140, 56, 352, 184, 139, 298],
  [73, 26, 57, 159, 272, 309]
];
const extremeRainByDay = Array.from({length:6}, (_, day) =>
  observedExtremeStationRain.map(station => station[day]));
const uhExtreme = model.unitHydrographForecast(unitHydrograph, {
  baseflowCms: 0,
  runoffCoefficient: unitHydrograph.runoff_coefficient.default,
  autoExtremeCalibration: true,
  apiOriginMm: 0,
  rainByDay: extremeRainByDay
});
assert.equal(uhExtreme.calibration_mode, 'auto_extreme_event');
assert.ok(uhExtreme.runoff_coefficients_by_day.every(value => value >= 0 && value <= 1));
assert.ok(uhExtreme.fast_response_fraction_by_day.every(value => value >= 0 && value <= 1));
assert.ok(Math.abs(Math.max(...uhExtreme.hourly.map(row => row.q_total_cms)) - 4022) / 4022 < 0.001);
assert.ok(uhExtreme.input_response_volume_mcm <=
  uhExtreme.basin_rain_mm.reduce((sum, value) => sum + value, 0) * unitHydrograph.basin_area_km2 / 1000);

model.validateUnitHydrographConfig(unitHydrograph174);
assert.equal(unitHydrograph174.station, 'X.174');
assert.equal(unitHydrograph174.rain_stations.length, 3);
assert.ok(Math.abs(unitHydrograph174.rain_stations.reduce((sum,row)=>sum+row.weight,0)-1)<0.000001);
assert.equal(unitHydrograph174.calibration.event_count, 90);
assert.equal(unitHydrograph174.rating_curve.all.r2, 0.9831);
const uh174 = model.unitHydrographForecast(unitHydrograph174, {
  baseflowCms: 5,
  runoffCoefficient: unitHydrograph174.runoff_coefficient.default,
  rainByDay: [
    [0,0,0], [0,0,0], [100,100,100], [0,0,0], [0,0,0], [0,0,0]
  ]
});
assert.equal(uh174.station, 'X.174');
assert.equal(uh174.method, 'x174_unit_hydrograph_convolution');
assert.equal(uh174.basin_rain_mm[2], 100);
assert.equal(uh174.hourly.length, 72);
assert.ok(uh174.daily.some(row=>row.peak_q_cms>5));
assert.ok(uh174.input_response_volume_mcm <= 100 * unitHydrograph174.basin_area_km2 / 1000);
const reference174 = unitHydrograph174.extreme_event_calibration.reference_event;
const referenceStationRain174 = unitHydrograph174.rain_stations.map(station =>
  reference174.station_rain_mm[station.code]);
const referenceRain174 = Array.from({length:6}, (_, day) =>
  referenceStationRain174.map(station => station[day]));
const replay174 = model.unitHydrographForecast(unitHydrograph174, {
  baseflowCms: 3.2,
  runoffCoefficient: unitHydrograph174.runoff_coefficient.default,
  autoExtremeCalibration: true,
  rainByDay: referenceRain174
});
const replayPeak174 = Math.max(...replay174.hourly.map(row => row.q_total_cms));
assert.equal(replay174.calibration_mode, 'auto_extreme_event');
assert.ok(Math.abs(replayPeak174 - reference174.observed_peak_cms) / reference174.observed_peak_cms < 0.02);
assert.ok(replay174.volume_correction_factors_by_day.every(value => value >= 1));
assert.ok(replay174.runoff_coefficients_by_day.every(value => value <= 1));
assert.equal(reference174.modeled_volume_mcm, 190.7);
assert.ok(Math.abs(reference174.modeled_peak_cms - reference174.observed_peak_cms) / reference174.observed_peak_cms < 0.002);

// Operational check: a dry antecedent period followed by heavy forecast rain
// must produce a visible X.174 response and retain the delayed runoff beyond day 3.
const futureHeavy174 = model.unitHydrographForecast(unitHydrograph174, {
  baseflowCms: 0,
  runoffCoefficient: unitHydrograph174.runoff_coefficient.default,
  autoExtremeCalibration: true,
  outputHours: 120,
  rainByDay: [0, 0, 0, 100, 130, 160].map(value => Array(3).fill(value))
});
const futureHeavyPeak174 = futureHeavy174.hourly.reduce((best, row) =>
  !best || row.q_total_cms > best.q_total_cms ? row : best, null);
assert.equal(futureHeavy174.hourly.length, 120);
assert.equal(futureHeavy174.daily.length, 5);
assert.ok(futureHeavy174.daily[1].peak_q_cms > 100);
assert.ok(futureHeavyPeak174.q_total_cms > 250);
assert.ok(futureHeavyPeak174.hour_index >= 72, 'combined three-day storm should peak after the old 72-hour display window');
assert.ok(futureHeavy174.forecast_window_direct_volume_mcm > 0.85 * futureHeavy174.corrected_input_response_volume_mcm);

const singlePulse174 = model.unitHydrographForecast(unitHydrograph174, {
  baseflowCms: 0,
  runoffCoefficient: unitHydrograph174.runoff_coefficient.default,
  autoExtremeCalibration: true,
  outputHours: 120,
  rainByDay: [0, 0, 0, 130, 0, 0].map(value => Array(3).fill(value))
});
const singlePulsePeak174 = singlePulse174.hourly.reduce((best, row) =>
  !best || row.q_total_cms > best.q_total_cms ? row : best, null);
assert.ok(singlePulsePeak174.hour_index >= 24 && singlePulsePeak174.hour_index <= 36,
  `X.174 heavy-rain peak lag was ${singlePulsePeak174.hour_index} hours`);

console.log('forecast model, X.90 and X.174 unit hydrograph tests: PASS');
