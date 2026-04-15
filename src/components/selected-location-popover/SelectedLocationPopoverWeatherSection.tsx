import { One } from '../../dkt-react-sync/components/One'
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
  onRefreshWeather: () => void
}

export function SelectedLocationPopoverWeatherSection({
  isEditingLocation,
  onRefreshWeather,
}: SelectedLocationPopoverWeatherSectionProps) {
  return (
    <One rel="weatherLocation" fallback={<PopoverWeatherSectionFallback />}>
      <SelectedLocationPopoverWeatherSectionInner
        isEditingLocation={isEditingLocation}
        onRefreshWeather={onRefreshWeather}
      />
    </One>
  )
}

function SelectedLocationPopoverWeatherSectionInner({
  isEditingLocation,
  onRefreshWeather,
}: SelectedLocationPopoverWeatherSectionProps) {
  const weatherLocationAttrs = useAttrs(['loadStatus', 'lastError'])
  const loadStatus = readStringAttr(weatherLocationAttrs.loadStatus, 'idle')
  const lastError = readNullableStringAttr(weatherLocationAttrs.lastError)
  const weatherLoadError = loadStatus === 'error' && lastError ? lastError : null

  return !isEditingLocation ? (
    <div className="selected-location-popover__body">
      <One
        rel="currentWeather"
        fallback={
          <SelectedLocationPopoverCurrentWeatherFallback
            weatherLoadError={weatherLoadError}
            onRefreshWeather={onRefreshWeather}
          />
        }
      >
        <SelectedLocationPopoverCurrentWeatherPanel onRefreshWeather={onRefreshWeather} />
      </One>

      <PopoverForecastColumns />
    </div>
  ) : null
}

function SelectedLocationPopoverCurrentWeatherPanel({
  onRefreshWeather,
}: {
  onRefreshWeather: () => void
}) {
  return (
    <article className="weather-readout weather-readout--popover">
      <CurrentWeatherCard onRetry={onRefreshWeather} />
    </article>
  )
}

function SelectedLocationPopoverCurrentWeatherFallback({
  weatherLoadError,
  onRefreshWeather,
}: {
  weatherLoadError: string | null
  onRefreshWeather: () => void
}) {
  return weatherLoadError ? (
    <WeatherReadoutError message={`Weather load failed: ${weatherLoadError}`} onRetry={onRefreshWeather} />
  ) : (
    <WeatherReadoutFallback />
  )
}