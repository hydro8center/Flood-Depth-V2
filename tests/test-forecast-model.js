'use strict';

const assert = require('node:assert/strict');
const config = require('../data/forecast-model.json');
const rating = require('../data/rating-tables.json');
const unitHydrograph = require('../data/x90-unit-hydrograph.json');
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

console.log('forecast model and X.90 unit hydrograph tests: PASS');
