export const readStringAttr = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

export const readNullableStringAttr = (value: unknown): string | null =>
  typeof value === 'string' ? value : null

export const readBooleanAttr = (value: unknown, fallback = false): boolean =>
  typeof value === 'boolean' ? value : fallback
