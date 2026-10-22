export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function parseJson(text: string): JsonValue | undefined {
  try {
    const parsed: JsonValue = JSON.parse(text)
    return parsed
  } catch {
    return undefined
  }
}

export function stringField(object: JsonObject, key: string): string | undefined {
  const value = object[key]
  return typeof value === "string" ? value : undefined
}

export function numberField(object: JsonObject, key: string): number | undefined {
  const value = object[key]
  return typeof value === "number" ? value : undefined
}

export function booleanField(object: JsonObject, key: string): boolean | undefined {
  const value = object[key]
  return typeof value === "boolean" ? value : undefined
}

export function objectField(object: JsonObject, key: string): JsonObject | undefined {
  const value = object[key]
  return isJsonObject(value) ? value : undefined
}

export function arrayField(object: JsonObject, key: string): JsonValue[] | undefined {
  const value = object[key]
  return Array.isArray(value) ? value : undefined
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
