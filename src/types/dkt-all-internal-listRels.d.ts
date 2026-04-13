declare module 'dkt-all/libs/provoda/_internal/_listRels.js' {
  type RuntimeModelLike = {
    _node_id?: string | null
    model_name?: string | null
    states?: Record<string, unknown>
    __getPublicAttrs?: () => readonly string[]
    getLinedStructure?: (
      options: unknown,
      config: unknown,
    ) => Promise<readonly RuntimeModelLike[]>
    input?: (callback: () => void | Promise<void>) => unknown
  }

  export function _listRels(model: RuntimeModelLike): Iterable<string>
  export function _getCurrentRel(
    model: RuntimeModelLike,
    relName: string,
  ): unknown
}