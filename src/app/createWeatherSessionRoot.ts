import { SessionRoot } from 'dkt-all/libs/provoda/bwlev/SessionRoot.js'
import { model } from 'dkt/model.js'
import RootRouter from './Routers/Root'

const WeatherSessionRoot = model({
  extends: SessionRoot,
  ...RootRouter,
})

export const createWeatherSessionRoot = () => WeatherSessionRoot
