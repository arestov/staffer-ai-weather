type CssNumberToken = number | `${number}`
type CssPercentageToken = `${number}%`

declare module 'react' {
  interface CSSProperties {
    '--sparkline-gap'?: CssPercentageToken
    '--weather-icon-size'?: CssNumberToken
    '--weather-icon-speed'?: CssNumberToken
  }
}

export {}