import { describe, expect, test } from 'vitest'
import {
  formatDailyLabel,
  formatHourlyLabel,
  formatTemperature,
  weatherCodeToSummary,
} from '../src/app/rels/weatherFormat'

describe('weather formatters', () => {
  test('formats known and unknown weather codes', () => {
    expect(weatherCodeToSummary(0, true)).toBe('Clear sky')
    expect(weatherCodeToSummary(0, false)).toBe('Clear sky')
    expect(weatherCodeToSummary(999, true)).toBe('Unknown conditions')
    expect(weatherCodeToSummary(null, true)).toBe('Unknown conditions')
  })

  test('formats temperatures with rounding and fallback', () => {
    expect(formatTemperature(18.4)).toBe('18 °C')
    expect(formatTemperature(18.5)).toBe('19 °C')
    expect(formatTemperature(null)).toBe('-- °C')
  })

  test('formats hourly labels from ISO values', () => {
    expect(formatHourlyLabel('2026-04-13T14:30:00Z')).toBe('14:30')
    expect(formatHourlyLabel('14:30')).toBe('14:30')
    expect(formatHourlyLabel(null)).toBe('--:--')
  })

  test('formats daily labels and falls back on invalid values', () => {
    expect(formatDailyLabel('2026-04-13')).toBe('Mon')
    expect(formatDailyLabel('invalid-date')).toBe('---')
    expect(formatDailyLabel(undefined)).toBe('---')
  })
})