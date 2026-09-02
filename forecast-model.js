(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HatYaiForecastModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function finiteNonNegative(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
      throw new TypeError(name + ' must be a finite number greater than or equal to zero');
    }
    return number;
  }

  function finiteCoefficient(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new TypeError(name + ' is missing or invalid');
    return number;
  }

  function validateDirectConfig(config) {
    if (!config.direct_models || !config.reported_validation) {
      throw new TypeError('direct-horizon model config is incomplete');
    }
    for (const station of ['X.173A', 'X.90']) {
      for (let horizon = 1; horizon <= 3; horizon += 1) {
        const model = config.direct_models[station] && config.direct_models[station][String(horizon)];
        if (!model || !model.coefficients) throw new TypeError(`${station} day ${horizon} model is missing`);
        for (const [feature, coefficient] of Object.entries(model.coefficients)) {
          finiteCoefficient(coefficient, `${station} day ${horizon} ${feature}`);
        }
      }
    }
  }

  function validateLegacyConfig(config) {
    const a = config.equations && config.equations.x173a;
    const b = config.equations && config.equations.x90;
    const coefficients = [
      a && a.intercept, a && a.q_self, a && a.rain_current, a && a.rain_previous,
      b && b.intercept, b && b.q_self, b && b.q_x173a,
      b && b.rain_current, b && b.rain_previous
    ];
    if (coefficients.some(value => !Number.isFinite(Number(value)))) {
      throw new TypeError('legacy forecast coefficients are incomplete');
    }
  }

  function validateConfig(config) {
    if (!config || ![1, 2].includes(config.schema) || !config.model_version) {
      throw new TypeError('forecast model config is invalid');
    }
    if (config.schema === 2) validateDirectConfig(config);
    else validateLegacyConfig(config);
    return config;
  }

  function directForecast(config, input) {
    validateConfig(config);
    if (config.schema !== 2) throw new TypeError('direct-horizon forecast requires schema 2');
    const values = {
      q173: finiteNonNegative(input.q173, 'q173'),
      q90: finiteNonNegative(input.q90, 'q90'),
      API_origin: finiteNonNegative(input.apiOrigin, 'apiOrigin'),
      P_past0: finiteNonNegative(input.rainPast0, 'rainPast0'),
      P_past1: finiteNonNegative(input.rainPast1, 'rainPast1'),
      P_past2: finiteNonNegative(input.rainPast2, 'rainPast2'),
      P_fcst1: finiteNonNegative(input.rainFcst1, 'rainFcst1'),
      P_fcst2: finiteNonNegative(input.rainFcst2, 'rainFcst2'),
      P_fcst3: finiteNonNegative(input.rainFcst3, 'rainFcst3')
    };

    function predict(station, horizon) {
      const model = config.direct_models[station][String(horizon)];
      const features = {
        Q_origin: station === 'X.173A' ? values.q173 : values.q90,
        API_origin: values.API_origin,
        P_past0: values.P_past0,
        P_past1: values.P_past1,
        P_past2: values.P_past2,
        P_fcst1: values.P_fcst1,
        P_fcst2: values.P_fcst2,
        P_fcst3: values.P_fcst3
      };
      let prediction = finiteCoefficient(model.coefficients.intercept, `${station} intercept`);
      for (const [feature, coefficient] of Object.entries(model.coefficients)) {
        if (feature === 'intercept') continue;
        if (!Object.hasOwn(features, feature)) throw new TypeError(`unsupported feature: ${feature}`);
        prediction += finiteCoefficient(coefficient, `${station} ${feature}`) * features[feature];
      }
      return Math.max(0, Number(prediction.toFixed(3)));
    }

    const horizons = [];
    for (let horizon = 1; horizon <= 3; horizon += 1) {
      const metrics173 = config.reported_validation['X.173A'][String(horizon)];
      const metrics90 = config.reported_validation['X.90'][String(horizon)];
      horizons.push({
        horizon_day: horizon,
        q_x173a_cms: predict('X.173A', horizon),
        q_x90_cms: predict('X.90', horizon),
        persistence_x173a_cms: values.q173,
        persistence_x90_cms: values.q90,
        test_rmse_x173a_cms: Number(metrics173.rmse_m3s),
        test_rmse_x90_cms: Number(metrics90.rmse_m3s),
        test_nse_x173a: Number(metrics173.nse),
        test_nse_x90: Number(metrics90.nse),
        forecast_rain_mm: values[`P_fcst${horizon}`]
      });
    }

    return {
      schema: 2,
      model_version: config.model_version,
      status: 'prototype_not_operational',
      method: 'direct_horizon',
      q_initial_cms: { 'X.173A': values.q173, 'X.90': values.q90 },
      inputs: {
        api_origin_mm: values.API_origin,
        rain_past_mm: [values.P_past2, values.P_past1, values.P_past0],
        rain_forecast_mm: [values.P_fcst1, values.P_fcst2, values.P_fcst3]
      },
      horizons
    };
  }

  function cascadeForecast(config, input) {
    validateConfig(config);
    if (config.schema !== 1) throw new TypeError('legacy cascade forecast requires schema 1');
    const q173Start = finiteNonNegative(input.q173, 'q173');
    const q90Start = finiteNonNegative(input.q90, 'q90');
    const rain = [
      finiteNonNegative(input.rainPrevious, 'rainPrevious'),
      finiteNonNegative(input.rainCurrent, 'rainCurrent'),
      finiteNonNegative(input.rainDay1, 'rainDay1'),
      finiteNonNegative(input.rainDay2, 'rainDay2')
    ];
    const a = config.equations.x173a;
    const b = config.equations.x90;
    let q173 = q173Start;
    let q90 = q90Start;
    const horizons = [];
    for (let horizon = 1; horizon <= 3; horizon += 1) {
      const previousQ173 = q173;
      const previousQ90 = q90;
      const rainCurrent = rain[horizon];
      const rainPrevious = rain[horizon - 1];
      q173 = Math.max(0, Number(a.intercept) + Number(a.q_self) * previousQ173
        + Number(a.rain_current) * rainCurrent + Number(a.rain_previous) * rainPrevious);
      q90 = Math.max(0, Number(b.intercept) + Number(b.q_self) * previousQ90
        + Number(b.q_x173a) * previousQ173 + Number(b.rain_current) * rainCurrent
        + Number(b.rain_previous) * rainPrevious);
      horizons.push({
        horizon_day: horizon,
        q_x173a_cms: Number(q173.toFixed(3)),
        q_x90_cms: Number(q90.toFixed(3)),
        rain_current_mm: rainCurrent,
        rain_previous_mm: rainPrevious
      });
    }
    return {
      schema: 1,
      model_version: config.model_version,
      status: 'prototype_not_operational',
      q_initial_cms: { 'X.173A': q173Start, 'X.90': q90Start },
      horizons
    };
  }

  function validateRatingConfig(config) {
    if (!config || config.schema !== 1 || !config.stations) {
      throw new TypeError('rating table config is invalid');
    }
    for (const station of ['X.173A', 'X.90']) {
      const item = config.stations[station];
      if (!item || !Array.isArray(item.values) || item.values.length < 2) {
        throw new TypeError(station + ' rating table is missing');
      }
      for (let i = 0; i < item.values.length; i += 1) {
        const pair = item.values[i];
        if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(Number.isFinite)) {
          throw new TypeError(station + ' rating row is invalid');
        }
        if (i && (pair[0] <= item.values[i - 1][0] || pair[1] < item.values[i - 1][1])) {
          throw new TypeError(station + ' rating table is not monotonic');
        }
      }
    }
    return config;
  }

  function stageToDischarge(config, station, stage) {
    validateRatingConfig(config);
    const h = Number(stage);
    if (!Number.isFinite(h)) throw new TypeError('stage must be a finite number');
    const table = config.stations[station] && config.stations[station].values;
    if (!table) throw new TypeError('unsupported rating station: ' + station);
    if (h < table[0][0] || h > table[table.length - 1][0]) return null;
    let low = 0, high = table.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (table[mid][0] === h) return Number(table[mid][1].toFixed(3));
      if (table[mid][0] < h) low = mid + 1;
      else high = mid - 1;
    }
    const a = table[high], b = table[low];
    const ratio = (h - a[0]) / (b[0] - a[0]);
    return Number((a[1] + ratio * (b[1] - a[1])).toFixed(3));
  }

  function dailyVolumeMcm(dischargeCms) {
    return Number((finiteNonNegative(dischargeCms, 'dischargeCms') * 86400 / 1e6).toFixed(6));
  }

  function hourlyVolumeMcm(dischargeCms) {
    return Number((finiteNonNegative(dischargeCms, 'dischargeCms') * 3600 / 1e6).toFixed(6));
  }

  function expandHourlyForecast(result) {
    if (!result || !Array.isArray(result.horizons)) throw new TypeError('forecast result is invalid');
    return result.horizons.flatMap(row => Array.from({ length:24 }, (_, hour) => ({
      horizon_day: row.horizon_day,
      hour_in_day: hour,
      hour_index: (row.horizon_day - 1) * 24 + hour,
      q_x173a_cms: row.q_x173a_cms,
      q_x90_cms: row.q_x90_cms,
      volume_x173a_mcm_hour: hourlyVolumeMcm(row.q_x173a_cms),
      volume_x90_mcm_hour: hourlyVolumeMcm(row.q_x90_cms)
    })));
  }

  return {
    cascadeForecast, directForecast, validateConfig,
    validateRatingConfig, stageToDischarge,
    dailyVolumeMcm, hourlyVolumeMcm, expandHourlyForecast
  };
});
