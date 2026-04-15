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
  const canvasRef = useLottieWeatherIcon(iconName)

  return (
    <canvas
      ref={canvasRef}
      width={size * (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1)}
      height={size * (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1)}
      className={className ?? 'weather-condition-icon'}
      style={{ width: size, height: size }}
      tabIndex={-1}
      aria-hidden
    />
  )
}
