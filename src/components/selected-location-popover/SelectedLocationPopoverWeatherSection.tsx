import { useCallback } from 'react'
import { One } from '../../dkt-react-sync/components/One'
import { useActions } from '../../dkt-react-sync/hooks/useActions'
import { useAttrs } from '../../dkt-react-sync/hooks/useAttrs'
import { readNullableStringAttr, readStringAttr } from '../../shared/attrReaders'
import {
  CurrentWeatherCard,
  PopoverForecastColumns,
  PopoverWeatherSectionFallback,
  WeatherReadoutError,
  WeatherReadoutFallback,
} from '../WeatherCards'

type SelectedLocationPopoverWeatherSectionProps = {
  isEditingLocation: boolean
}

export function SelectedLocationPopoverWeatherSection({
  isEditingLocation,
}: SelectedLocationPopoverWeatherSectionProps) {
  return (
    <One rel="weatherLocation" fallback={<PopoverWeatherSectionFallback />}>
      <SelectedLocationPopoverWeatherSectionInner isEditingLocation={isEditingLocation} />
    </One>
  )
}

function SelectedLocationPopoverWeatherSectionInner({
  isEditingLocation,
}: SelectedLocationPopoverWeatherSectionProps) {
  const dispatch = useActions()
  const weatherLocationAttrs = useAttrs(['loadStatus', 'lastError'])
  const loadStatus = readStringAttr(weatherLocationAttrs.loadStatus, 'idle')
  const lastError = readNullableStringAttr(weatherLocationAttrs.lastError)
  const weatherLoadError = loadStatus === 'error' && lastError ? lastError : null
  const handleRetryWeather = useCallback(() => {
    dispatch('retryWeatherLoad')
  }, [dispatch])

  return !isEditingLocation ? (
    <div className="selected-location-popover__body">
      <One
        rel="currentWeather"
        fallback={
          <SelectedLocationPopoverCurrentWeatherFallback
            weatherLoadError={weatherLoadError}
            onRetryWeather={handleRetryWeather}
          />
        }
      >
        <SelectedLocationPopoverCurrentWeatherPanel onRetryWeather={handleRetryWeather} />
      </One>

      <PopoverForecastColumns />
    </div>
  ) : null
}

function SelectedLocationPopoverCurrentWeatherPanel({
  onRetryWeather,
}: {
  onRetryWeather: () => void
}) {
  return (
    <article className="weather-readout weather-readout--popover">
      <CurrentWeatherCard onRetry={onRetryWeather} />
    </article>
  )
}

function SelectedLocationPopoverCurrentWeatherFallback({
  weatherLoadError,
  onRetryWeather,
}: {
  weatherLoadError: string | null
  onRetryWeather: () => void
}) {
  return weatherLoadError ? (
    <WeatherReadoutError
      message={`Weather load failed: ${weatherLoadError}`}
      onRetry={onRetryWeather}
    />
  ) : (
    <WeatherReadoutFallback />
  )
}
