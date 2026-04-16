import { useLottieWeatherIcon } from '../lottie/useLottieWeatherIcon'
import { weatherCodeToMeteocon } from '../lottie/weatherCodeToMeteocon'

export function WeatherConditionIcon({
  weatherCode,
  isDay,
  className,
}: {
  weatherCode: number | null | undefined
  isDay: boolean | null | undefined
  className?: string
}) {
  const iconName = weatherCodeToMeteocon(weatherCode, isDay)

  if (!iconName) {
    return null
  }

  return <WeatherConditionIconInner key={iconName} iconName={iconName} className={className} />
}

function WeatherConditionIconInner({
  iconName,
  className,
}: {
  iconName: string
  className?: string
}) {
  const containerRef = useLottieWeatherIcon(iconName)

  return (
    <div ref={containerRef} className={className ?? 'weather-condition-icon'} aria-hidden="true" />
  )
}
