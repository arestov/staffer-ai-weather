declare module 'dkt/dcl/attrs/input.js' {
  export const input: <T extends Record<string, unknown>>(
    values: T,
  ) => {
    [K in keyof T]: ['input', T[K]]
  }
}

declare module 'dkt-all/libs/provoda/bwlev/requireRouter.js' {
  export const requireRouter: (self: unknown, router_name: string) => Promise<any>
}
