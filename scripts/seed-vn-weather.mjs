#!/usr/bin/env node

// Open-Meteo weather + AQI for VN cities — fork PR-3d. Open-Meteo is an
// open-source weather API (CC-BY 4.8 for the API, data under ODbL from
// national weather services including DWD/NOAA models) with no API key and
// no rate limit for non-commercial use — the cleanest source the fork has.
//
// Two API calls per city (forecast + air quality), 5 cities, one seeder:
// current conditions, 5-day daily forecast, and US AQI. The payload serves
// the VN Weather panel alongside the NCHMF warnings (PR-3a).

import { loadEnvFile, runSeed } from './_seed-utils.mjs';
import { tokensToContentMeta, DAY_MIN } from './_content-age-helpers.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'vn:weather:v1';
// TTL must OUTLIVE the 60-minute staleness gate (seed-ttl fleet test).
const TTL = 7200;
// 30-minute cron (BUILD-PLAN: "1 giờ"; we poll slightly faster for the
// hazard-adjacent surface), maxStale 2× the cycle.
const VN_WX_MAX_STALE_MIN = 60;
// The forecast model updates every ~1h; a 12-hour budget absorbs model lag
// without flagging a genuinely stale feed.
const VN_WX_MAX_CONTENT_AGE_MIN = 12 * 60;

const OM_UA = 'RealtimeMonitor/1.0 (vn-weather seeder)';

// The cities the VN variant surfaces on its weather panel.
const CITIES = Object.freeze([
  { name: 'Hà Nội', slug: 'ha-noi', latitude: 21.03, longitude: 105.85 },
  { name: 'TP.HCM', slug: 'tp-hcm', latitude: 10.82, longitude: 106.63 },
  { name: 'Đà Nẵng', slug: 'da-nang', latitude: 16.05, longitude: 108.20 },
  { name: 'Hải Phòng', slug: 'hai-phong', latitude: 20.86, longitude: 106.68 },
  { name: 'Cần Thơ', slug: 'can-tho', latitude: 10.03, longitude: 105.78 },
]);

const FORECAST_PARAMS = 'current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=Asia%2FBangkok&forecast_days=5';
const AQI_PARAMS = 'current=pm10,pm2_5,us_aqi&timezone=Asia%2FBangkok';

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Map one city's Open-Meteo forecast + AQI onto the seeded row. Throws on
 * structural surprises (BUILD-PLAN §5.7).
 */
export function parseCityWeather(city, forecastBody, aqiBody) {
  const current = forecastBody?.current;
  const daily = forecastBody?.daily;
  if (!current || typeof current !== 'object') {
    throw new Error(`Open-Meteo forecast for ${city.slug} has no current block`);
  }
  if (!daily || !Array.isArray(daily.time) || daily.time.length === 0) {
    throw new Error(`Open-Meteo forecast for ${city.slug} has no daily block`);
  }
  // AQI is best-effort: the air-quality API can lag or miss a grid cell.
  const aqiCurrent = aqiBody?.current ?? {};

  const dailyForecast = daily.time.map((date, i) => ({
    date,
    tempMax: toNumber(daily.temperature_2m_max?.[i]),
    tempMin: toNumber(daily.temperature_2m_min?.[i]),
    precipitationMm: toNumber(daily.precipitation_sum?.[i]),
  })).filter((d) => d.tempMax !== null && d.tempMin !== null);

  if (dailyForecast.length === 0) {
    throw new Error(`Open-Meteo forecast for ${city.slug} yielded no usable daily entries`);
  }

  return {
    slug: city.slug,
    name: city.name,
    latitude: city.latitude,
    longitude: city.longitude,
    current: {
      temperatureC: toNumber(current.temperature_2m),
      humidityPct: toNumber(current.relative_humidity_2m),
      windKmh: toNumber(current.wind_speed_10m),
      // WMO weather code (0=clear, 1-3=partly cloudy, 45-48=fog, 51-67=rain,
      // 71-77=snow, 80-82=showers, 95-99=thunderstorm).
      weatherCode: toNumber(current.weather_code),
    },
    daily: dailyForecast,
    aqi: {
      usAqi: toNumber(aqiCurrent.us_aqi),
      pm25: toNumber(aqiCurrent.pm2_5),
      pm10: toNumber(aqiCurrent.pm10),
    },
  };
}

async function fetchJson(url) {
  const resp = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': OM_UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!resp.ok) throw new Error(`Open-Meteo HTTP ${resp.status}: ${url.slice(0, 80)}`);
  return resp.json();
}

async function fetchVnWeather() {
  const cities = [];
  for (const city of CITIES) {
    const [forecast, aqi] = await Promise.all([
      fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${city.latitude}&longitude=${city.longitude}&${FORECAST_PARAMS}`),
      fetchJson(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${city.latitude}&longitude=${city.longitude}&${AQI_PARAMS}`).catch(() => null),
    ]);
    cities.push(parseCityWeather(city, forecast, aqi));
  }
  console.log(`  VN weather: ${cities.length} cities, HN ${cities[0].current.temperatureC}°C AQI ${cities[0].aqi.usAqi ?? 'n/a'}`);
  return { cities, seededAt: Date.now(), recordCount: cities.length };
}

export function validate(data) {
  const cities = data?.cities;
  if (!Array.isArray(cities) || cities.length !== CITIES.length) return false;
  const slugs = new Set();
  for (const c of cities) {
    if (typeof c?.slug !== 'string' || slugs.has(c.slug)) return false;
    slugs.add(c.slug);
    // Temperature sanity: VN never sees -20°C or +55°C.
    if (!(c.current?.temperatureC >= -20 && c.current?.temperatureC <= 55)) return false;
    if (!Array.isArray(c.daily) || c.daily.length < 3) return false;
    for (const d of c.daily) {
      if (!(d.tempMax >= -20 && d.tempMax <= 55)) return false;
      if (!(d.tempMin >= -20 && d.tempMin <= 55)) return false;
      if (d.tempMin > d.tempMax) return false;
    }
  }
  return true;
}

export function declareRecords(data) {
  return Array.isArray(data?.cities) ? data.cities.length : 0;
}

// Content-age: the newest daily forecast date — detects a model feed that
// keeps serving yesterday's forecast.
export function vnWeatherContentMeta(data, nowMs = Date.now()) {
  const tokens = [];
  for (const c of data?.cities ?? []) {
    for (const d of c?.daily ?? []) {
      if (typeof d?.date === 'string' && d.date !== '') tokens.push(d.date);
    }
  }
  return tokens.length ? tokensToContentMeta(tokens, nowMs) : null;
}

if (process.argv[1]?.endsWith('seed-vn-weather.mjs')) {
  runSeed('vn', 'weather', CANONICAL_KEY, fetchVnWeather, {
    validateFn: validate,
    ttlSeconds: TTL,
    sourceVersion: 'open-meteo-v1',
    recordCount: (data) => (Array.isArray(data?.cities) ? data.cities.length : 0),
    declareRecords,
    schemaVersion: 1,
    maxStaleMin: VN_WX_MAX_STALE_MIN,
    contentMeta: vnWeatherContentMeta,
    maxContentAgeMin: VN_WX_MAX_CONTENT_AGE_MIN,
  }).catch(err => {
    const cause = err.cause ? ` (cause: ${err.cause.message || err.cause.code || err.cause})` : '';
    console.error('FATAL:', (err.message || err) + cause);
    process.exit(1);
  });
}
