// VN weather seeder + mapper — fork PR-3d.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  declareRecords,
  parseCityWeather,
  validate,
  vnWeatherContentMeta,
} from '../scripts/seed-vn-weather.mjs';
import {
  describeAqi,
  describeWeatherCode,
  toVnWeatherCityRows,
} from '../src/services/vn-weather-cities.ts';

const HN = { name: 'Hà Nội', slug: 'ha-noi', latitude: 21.03, longitude: 105.85 };
const HCM = { name: 'TP.HCM', slug: 'tp-hcm', latitude: 10.82, longitude: 106.63 };

function forecastBody(current = { temperature_2m: 32.2, relative_humidity_2m: 57, wind_speed_10m: 10.2, weather_code: 1 }) {
  return {
    current,
    daily: {
      time: ['2026-10-25', '2026-10-26', '2026-10-27'],
      temperature_2m_max: [32.4, 30.9, 30.9],
      temperature_2m_min: [26.1, 25.0, 24.8],
      precipitation_sum: [0.7, 4.5, 0.3],
    },
  };
}

function aqiBody(current = { us_aqi: 95, pm2_5: 34.6, pm10: 35.0 }) {
  return { current };
}

test('parses the live Open-Meteo shape: current, daily, AQI', () => {
  const row = parseCityWeather(HN, forecastBody(), aqiBody());
  assert.equal(row.slug, 'ha-noi');
  assert.equal(row.current.temperatureC, 32.2);
  assert.equal(row.current.humidityPct, 57);
  assert.equal(row.current.windKmh, 10.2);
  assert.equal(row.current.weatherCode, 1);
  assert.equal(row.aqi.usAqi, 95);
  assert.equal(row.aqi.pm25, 34.6);
  assert.equal(row.daily.length, 3);
  assert.equal(row.daily[0].date, '2026-10-25');
  assert.equal(row.daily[0].tempMax, 32.4);
  assert.equal(row.daily[0].tempMin, 26.1);
  assert.equal(row.daily[0].precipitationMm, 0.7);
});

test('AQI failure degrades to null, not a crash', () => {
  const row = parseCityWeather(HN, forecastBody(), null);
  assert.equal(row.aqi.usAqi, null);
  assert.equal(row.aqi.pm25, null);
});

test('structural surprises fail loud', () => {
  assert.throws(() => parseCityWeather(HN, {}, aqiBody()), /no current/);
  assert.throws(() => parseCityWeather(HN, { current: {} }, aqiBody()), /no daily/);
  // All daily entries unusable.
  const bad = { current: { temperature_2m: 32 }, daily: { time: ['x'], temperature_2m_max: [null], temperature_2m_min: [null] } };
  assert.throws(() => parseCityWeather(HN, bad, null), /no usable daily/);
});

function payloadWith(cities) {
  return { cities, seededAt: Date.now(), recordCount: cities.length };
}
function cityRow(slug, overrides = {}) {
  return {
    slug, name: slug, latitude: 21, longitude: 105,
    current: { temperatureC: 30, humidityPct: 60, windKmh: 5, weatherCode: 1 },
    daily: [
      { date: '2026-10-25', tempMax: 32, tempMin: 26, precipitationMm: 0 },
      { date: '2026-10-26', tempMax: 31, tempMin: 25, precipitationMm: 1 },
      { date: '2026-10-27', tempMax: 30, tempMin: 24, precipitationMm: null },
    ],
    aqi: { usAqi: 80, pm25: 20, pm10: 30 },
    ...overrides,
  };
}

test('validate anchors the 5-city board and temperature sanity', () => {
  const cities = ['ha-noi', 'tp-hcm', 'da-nang', 'hai-phong', 'can-tho'].map(s => cityRow(s));
  const board = payloadWith(cities);
  assert.equal(validate(board), true);
  assert.equal(declareRecords(board), 5);
  assert.ok(vnWeatherContentMeta(board), 'content meta derives from daily dates');

  // Wrong count.
  assert.equal(validate(payloadWith(cities.slice(0, 4))), false);
  // Impossible temperature.
  assert.equal(validate(payloadWith([
    ...cities.slice(0, 4), cityRow('can-tho', { current: { temperatureC: 99, humidityPct: 1, windKmh: 1, weatherCode: 0 } }),
  ])), false);
  // tempMin > tempMax in the daily block.
  assert.equal(validate(payloadWith([
    ...cities.slice(0, 4),
    cityRow('can-tho', { daily: [{ date: 'x', tempMax: 20, tempMin: 25, precipitationMm: 0 }] }),
  ])), false);
  assert.equal(validate(undefined), false);
});

test('mapper: drops cities without current temp, keeps the rest', () => {
  const payload = payloadWith([
    cityRow('ha-noi'),
    cityRow('tp-hoc', { current: { temperatureC: null, humidityPct: 60, windKmh: 5, weatherCode: 1 } }), // dropped
    cityRow('da-nang', { aqi: { usAqi: null, pm25: null, pm10: null } }), // kept, AQI null
  ]);
  const rows = toVnWeatherCityRows(payload);
  assert.deepEqual(rows.map((r) => r.slug), ['ha-noi', 'da-nang']);
  assert.equal(rows[1].aqi.usAqi, null);
  assert.equal(toVnWeatherCityRows({ _seed: {}, data: payload }).length, 2);
  for (const bad of [undefined, null, {}, { cities: null }, [], 'x', 42]) {
    assert.deepEqual(toVnWeatherCityRows(bad), [], `expected [] for ${JSON.stringify(bad)}`);
  }
});

test('weather-code and AQI descriptors', () => {
  assert.equal(describeWeatherCode(0).icon, '☀');
  assert.equal(describeWeatherCode(95).icon, '⛈');
  assert.equal(describeWeatherCode(null).icon, '·');
  assert.equal(describeAqi(30).className, 'aqi-good');
  assert.equal(describeAqi(95).className, 'aqi-moderate');
  assert.equal(describeAqi(160).className, 'aqi-unhealthy');
  assert.equal(describeAqi(350).className, 'aqi-hazardous');
  assert.equal(describeAqi(null).label, '--');
});
