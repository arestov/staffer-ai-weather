import { merge as mergeDcl } from 'dkt/dcl/merge.js'
import { requireRouter } from 'dkt-all/libs/provoda/bwlev/requireRouter.js'
import { SelectedLocationPopoverRouter } from './SelectedLocationPopover'

const ROUTER_PREFIX = 'router-'

const RootRouter = mergeDcl({
  model_name: 'weather_session_root',
  attrs: {
    sessionKey: ['input', null],
    route: ['input', null],
    closedAt: ['input', null],
    isCommonRoot: ['input', false],
  },
  rels: {
    'router-selectedLocationPopover': ['nest', [SelectedLocationPopoverRouter]],
  },
  actions: {
    focusRouterResource: {
      to: ['$noop'],
      fn: [
        ['$noop', '<<<<'],
        async (
          data: { context_md_id?: unknown; router_name?: unknown },
          noop: unknown,
          self: Parameters<typeof requireRouter>[0],
        ) => {
          const routerName =
            typeof data?.router_name === 'string' ? data.router_name : null
          const contextModelId =
            typeof data?.context_md_id === 'string' ? data.context_md_id : null

          if (!routerName || !contextModelId) {
            return noop
          }

          const bareRouterName = routerName.startsWith(ROUTER_PREFIX)
            ? routerName.slice(ROUTER_PREFIX.length)
            : routerName
          const router = await requireRouter(self, bareRouterName)

          router.__dispatchAsInlineSubWalker('navigateToResource', {
            context_md_id: contextModelId,
          })

          return noop
        },
      ],
    },
    clearRouterCurrent: {
      to: ['$noop'],
      fn: [
        ['$noop', '<<<<'],
        async (
          data: { router_name?: unknown },
          noop: unknown,
          self: Parameters<typeof requireRouter>[0],
        ) => {
          const routerName =
            typeof data?.router_name === 'string' ? data.router_name : null

          if (!routerName) {
            return noop
          }

          const bareRouterName = routerName.startsWith(ROUTER_PREFIX)
            ? routerName.slice(ROUTER_PREFIX.length)
            : routerName
          const router = await requireRouter(self, bareRouterName)

          router.__dispatchAsInlineSubWalker('eraseModel')

          return noop
        },
      ],
    },
  },
})

export default RootRouter

