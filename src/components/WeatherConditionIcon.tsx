import { weatherCodeToMeteocon } from '../lottie/weatherCodeToMeteocon'
import { useLottieWeatherIcon } from '../lottie/useLottieWeatherIcon'

export function WeatherConditionIcon({
  weatherCode,
  isDay,
  size = 48,
  className,
}: {
  weatherCode: number | null | undefined
  isDay: boolean | null | undefined
  size?: number
  className?: string
}) {
  const iconName = weatherCodeToMeteocon(weatherCode, isDay)

  if (!iconName) {
    return null
  }

  return <WeatherConditionIconInner key={iconName} iconName={iconName} size={size} className={className} />
}

function WeatherConditionIconInner({
  iconName,
  size,
  className,
}: {
  iconName: string
  size: number
  className?: string
}) {
  const containerRef = useLottieWeatherIcon(iconName, size)

  return (
    <div
      ref={containerRef}
      className={className ?? 'weather-condition-icon'}
      aria-hidden="true"
    />
  )
}
