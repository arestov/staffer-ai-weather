import { SessionRoot as Base } from 'dkt-all/libs/provoda/bwlev/SessionRoot.js'
import { model } from 'dkt/model.js'
import RootRouter from './Routers/Root'

export const SessionRoot = model({
  extends: Base,
  ...RootRouter,
})
