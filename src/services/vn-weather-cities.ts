/**
 * VN weather board mappers — the fork's PR-3d
 * (`vn:weather:v1`, seeded by scripts/seed-vn-weather.mjs from
 * Open-Meteo forecast + AQI for 5 VN cities).
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unwrapEnvelope(payload: unknown, marker?: string): unknown {
  if (!isRecord(payload)) return payload;
  if (marker !== undefined && marker in payload) return payload;
  if (isRecord(payload.data)) return payload.data;
  return payload;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

export type VnWeatherDailyEntry = {
  date: string;
  tempMax: number;
  tempMin: number;
  precipitationMm: number | null;
};

export type VnWeatherCityRow = {
  slug: string;
  name: string;
  latitude: number;
  longitude: number;
  current: {
    temperatureC: number | null;
    humidityPct: number | null;
    windKmh: number | null;
    /** WMO weather code (0=clear … 95-99=thunderstorm). */
    weatherCode: number | null;
  };
  daily: VnWeatherDailyEntry[];
  aqi: {
    usAqi: number | null;
    pm25: number | null;
    pm10: number | null;
  };
};

/** WMO weather-code → short CSS class + emoji label. */
export function describeWeatherCode(code: number | null): { icon: string; label: string } {
  if (code === null) return { icon: '·', label: '' };
  if (code === 0) return { icon: '☀', label: 'Clear' };
  if (code >= 1 && code <= 3) return { icon: '⛅', label: 'Partly cloudy' };
  if (code >= 45 && code <= 48) return { icon: '🌫', label: 'Fog' };
  if (code >= 51 && code <= 67) return { icon: '🌧', label: 'Rain' };
  if (code >= 71 && code <= 77) return { icon: '🌨', label: 'Snow' };
  if (code >= 80 && code <= 82) return { icon: '🌦', label: 'Showers' };
  if (code >= 95 && code <= 99) return { icon: '⛈', label: 'Thunderstorm' };
  return { icon: '·', label: '' };
}

/** US AQI category + color for the badge. */
export function describeAqi(aqi: number | null): { label: string; className: string } {
  if (aqi === null) return { label: '--', className: 'fx-na' };
  if (aqi <= 50) return { label: String(aqi), className: 'aqi-good' };
  if (aqi <= 100) return { label: String(aqi), className: 'aqi-moderate' };
  if (aqi <= 150) return { label: String(aqi), className: 'aqi-unhealthy-sensitive' };
  if (aqi <= 200) return { label: String(aqi), className: 'aqi-unhealthy' };
  if (aqi <= 300) return { label: String(aqi), className: 'aqi-very-unhealthy' };
  return { label: String(aqi), className: 'aqi-hazardous' };
}

/**
 * Project `vn:weather:v1` onto city rows, seeded order (HN, HCMC, …).
 * A city with no usable current temperature is dropped.
 *
 * @param payload the `vn:weather:v1` value, enveloped or not
 */
export function toVnWeatherCityRows(payload: unknown): VnWeatherCityRow[] {
  const unwrapped = unwrapEnvelope(payload, 'cities');
  if (!isRecord(unwrapped)) return [];
  const cities = unwrapped.cities;
  if (!Array.isArray(cities)) return [];

  const rows: VnWeatherCityRow[] = [];
  for (const city of cities) {
    if (!isRecord(city)) continue;
    const slug = nonEmptyString(city.slug);
    const name = nonEmptyString(city.name);
    if (slug === null || name === null) continue;
    const current = isRecord(city.current) ? city.current : {};
    const temp = finiteNumber(current.temperatureC);
    if (temp === null) continue;
    const aqi = isRecord(city.aqi) ? city.aqi : {};
    const daily: VnWeatherDailyEntry[] = [];
    if (Array.isArray(city.daily)) {
      for (const d of city.daily) {
        if (!isRecord(d)) continue;
        const date = nonEmptyString(d.date);
        const tempMax = finiteNumber(d.tempMax);
        const tempMin = finiteNumber(d.tempMin);
        if (date === null || tempMax === null || tempMin === null) continue;
        daily.push({ date, tempMax, tempMin, precipitationMm: finiteNumber(d.precipitationMm) });
      }
    }
    rows.push({
      slug, name,
      latitude: finiteNumber(city.latitude) ?? 0,
      longitude: finiteNumber(city.longitude) ?? 0,
      current: {
        temperatureC: temp,
        humidityPct: finiteNumber(current.humidityPct),
        windKmh: finiteNumber(current.windKmh),
        weatherCode: finiteNumber(current.weatherCode),
      },
      daily,
      aqi: {
        usAqi: finiteNumber(aqi.usAqi),
        pm25: finiteNumber(aqi.pm25),
        pm10: finiteNumber(aqi.pm10),
      },
    });
  }
  return rows;
}
