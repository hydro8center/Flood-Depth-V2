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

  function validateUnitHydrographConfig(config) {
    if (!config || config.schema !== 1 || config.station !== 'X.90') {
      throw new TypeError('X.90 unit hydrograph config is invalid');
    }
    const area = finiteNonNegative(config.basin_area_km2, 'basin_area_km2');
    const stations = config.rain_stations;
    const fractions = config.unit_hydrograph && config.unit_hydrograph.hourly_volume_fraction;
    if (!area || !Array.isArray(stations) || stations.length < 2 || !Array.isArray(fractions) || !fractions.length) {
      throw new TypeError('X.90 unit hydrograph config is incomplete');
    }
    const weightSum = stations.reduce((sum, station) => sum + finiteNonNegative(station.weight, 'rain station weight'), 0);
    const fractionSum = fractions.reduce((sum, value) => sum + finiteNonNegative(value, 'unit hydrograph fraction'), 0);
    if (Math.abs(weightSum - 1) > 0.001) throw new TypeError('rain station weights must sum to one');
    if (Math.abs(fractionSum - 1) > 0.000001) throw new TypeError('unit hydrograph fractions must sum to one');
    const extreme = config.extreme_event_calibration;
    if (extreme) {
      const fast = extreme.fast_response && extreme.fast_response.hourly_volume_fraction;
      if (!Array.isArray(fast) || fast.length !== fractions.length) {
        throw new TypeError('extreme-event fast response is incomplete');
      }
      const fastSum = fast.reduce((sum, value) => sum + finiteNonNegative(value, 'fast-response fraction'), 0);
      if (Math.abs(fastSum - 1) > 0.000001) throw new TypeError('fast-response fractions must sum to one');
      const maximum = finiteNonNegative(extreme.coefficient && extreme.coefficient.maximum, 'maximum runoff coefficient');
      if (maximum > 1) throw new TypeError('maximum runoff coefficient must not exceed one');
    }
    return config;
  }

  function smoothStep01(value) {
    const x = Math.max(0, Math.min(1, value));
    return x * x * (3 - 2 * x);
  }

  function scaledSmoothStep(value, start, end) {
    if (!(end > start)) return value >= end ? 1 : 0;
    return smoothStep01((value - start) / (end - start));
  }

  function unitHydrographForecast(config, input) {
    validateUnitHydrographConfig(config);
    const baseflowCms = finiteNonNegative(input.baseflowCms, 'baseflowCms');
    const runoffCoefficient = finiteNonNegative(input.runoffCoefficient, 'runoffCoefficient');
    if (runoffCoefficient > 1) throw new TypeError('runoffCoefficient must not exceed one');
    const dayOffsets = [-2, -1, 0, 1, 2, 3];
    if (!Array.isArray(input.rainByDay) || input.rainByDay.length !== dayOffsets.length) {
      throw new TypeError('rainByDay must contain six daily station rows');
    }
    const rawWeights = config.rain_stations.map(station => Number(station.weight));
    const rawWeightSum = rawWeights.reduce((sum, value) => sum + value, 0);
    const weights = rawWeights.map(value => value / rawWeightSum);
    const basinRain = input.rainByDay.map((row, dayIndex) => {
      if (!Array.isArray(row) || row.length !== weights.length) {
        throw new TypeError('rainByDay row ' + dayIndex + ' has the wrong station count');
      }
      return row.reduce((sum, value, stationIndex) =>
        sum + finiteNonNegative(value, `rainByDay ${dayIndex} station ${stationIndex}`) * weights[stationIndex], 0);
    });
    const extreme = input.autoExtremeCalibration === true ? config.extreme_event_calibration : null;
    const slowFractions = config.unit_hydrograph.hourly_volume_fraction.map(Number);
    let api = 0;
    const apiByDay = basinRain.map((rain, dayIndex) => {
      api = rain + (dayIndex ? Number(extreme && extreme.api_alpha || 0.88) * api : 0);
      if (dayIndex === 2 && Number.isFinite(Number(input.apiOriginMm))) {
        api = Math.max(api, finiteNonNegative(input.apiOriginMm, 'apiOriginMm'));
      }
      return api;
    });
    const coefficientByDay = basinRain.map((_, dayIndex) => {
      if (!extreme) return runoffCoefficient;
      const rule = extreme.coefficient;
      const activation = scaledSmoothStep(
        apiByDay[dayIndex], Number(rule.saturation_start_api_mm), Number(rule.saturation_full_api_mm)
      );
      return Number(rule.base) + (Number(rule.maximum) - Number(rule.base)) * activation;
    });
    const fastMixByDay = basinRain.map((_, dayIndex) => {
      if (!extreme) return 0;
      const rule = extreme.fast_response;
      return Number(rule.maximum_fraction) * scaledSmoothStep(
        apiByDay[dayIndex], Number(rule.activation_start_api_mm), Number(rule.activation_full_api_mm)
      );
    });
    const effectiveRain = basinRain.map((value, index) => value * coefficientByDay[index]);
    const areaVolumePerMm = Number(config.basin_area_km2) * 1000;
    const fastFractions = extreme
      ? extreme.fast_response.hourly_volume_fraction.map(Number)
      : slowFractions;
    const hourly = Array.from({ length:72 }, (_, outputHour) => {
      const absoluteHour = 24 + outputHour;
      let directVolumeM3 = 0;
      dayOffsets.forEach((offset, dayIndex) => {
        const lag = absoluteHour - offset * 24;
        if (lag >= 0 && lag < slowFractions.length) {
          const fastMix = fastMixByDay[dayIndex];
          const responseFraction = slowFractions[lag] * (1 - fastMix) + fastFractions[lag] * fastMix;
          directVolumeM3 += effectiveRain[dayIndex] * areaVolumePerMm * responseFraction;
        }
      });
      const qDirect = directVolumeM3 / 3600;
      return {
        hour_index: outputHour,
        horizon_day: Math.floor(outputHour / 24) + 1,
        hour_in_day: outputHour % 24,
        q_direct_cms: Number(qDirect.toFixed(6)),
        q_total_cms: Number((baseflowCms + qDirect).toFixed(6)),
        direct_volume_mcm_hour: Number((directVolumeM3 / 1e6).toFixed(9)),
        total_volume_mcm_hour: Number(((baseflowCms * 3600 + directVolumeM3) / 1e6).toFixed(9))
      };
    });
    const daily = [1, 2, 3].map(day => {
      const rows = hourly.filter(row => row.horizon_day === day);
      return {
        horizon_day: day,
        volume_mcm_day: Number(rows.reduce((sum, row) => sum + row.total_volume_mcm_hour, 0).toFixed(6)),
        direct_volume_mcm_day: Number(rows.reduce((sum, row) => sum + row.direct_volume_mcm_hour, 0).toFixed(6)),
        mean_q_cms: Number((rows.reduce((sum, row) => sum + row.q_total_cms, 0) / 24).toFixed(3)),
        peak_q_cms: Number(Math.max(...rows.map(row => row.q_total_cms)).toFixed(3))
      };
    });
    return {
      schema: 1,
      method: 'x90_unit_hydrograph_convolution',
      basin_area_km2: Number(config.basin_area_km2),
      baseflow_cms: baseflowCms,
      runoff_coefficient: runoffCoefficient,
      calibration_mode: extreme ? 'auto_extreme_event' : 'manual_constant_coefficient',
      runoff_coefficients_by_day: coefficientByDay.map(value => Number(value.toFixed(6))),
      antecedent_precipitation_index_mm: apiByDay.map(value => Number(value.toFixed(3))),
      fast_response_fraction_by_day: fastMixByDay.map(value => Number(value.toFixed(6))),
      reference_event: extreme ? extreme.reference_event : null,
      basin_rain_mm: basinRain.map(value => Number(value.toFixed(3))),
      effective_rain_mm: effectiveRain.map(value => Number(value.toFixed(3))),
      input_response_volume_mcm: Number((effectiveRain.reduce((sum, value) => sum + value, 0) * areaVolumePerMm / 1e6).toFixed(6)),
      forecast_window_direct_volume_mcm: Number(hourly.reduce((sum, row) => sum + row.direct_volume_mcm_hour, 0).toFixed(6)),
      hourly,
      daily
    };
  }

  return {
    cascadeForecast, directForecast, validateConfig,
    validateRatingConfig, stageToDischarge,
    dailyVolumeMcm, hourlyVolumeMcm, expandHourlyForecast,
    validateUnitHydrographConfig, unitHydrographForecast
  };
});
