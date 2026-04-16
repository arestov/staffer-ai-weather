import { model } from 'dkt/model.js'
import { SessionRoot as Base } from 'dkt-all/libs/provoda/bwlev/SessionRoot.js'
import RootRouter from './RootRouter'

export const SessionRoot = model({
  extends: Base,
  ...RootRouter,
})
