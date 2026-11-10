// Vendored from the dsh-web family's shared host HTTP helpers for this
// standalone package (no shared/ tree here).
/**
 * Shared JSON body/response helpers for the host route family: one lenient
 * bounded body reader, one JSON object narrow, and one JSON writer.
 * @module taskboard/host/http
 */

import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http'

/** Default body cap for readJsonBody: 64 KiB. */
const DEFAULT_JSON_BODY_MAX_BYTES = 64 * 1024

/** Family-default JSON response headers; callers may append or override. */
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'referrer-policy': 'no-referrer',
} satisfies OutgoingHttpHeaders

/**
 * Lenient bounded body reader: parse a request body as JSON, or null on an
 * empty body, invalid JSON, or a body past maxBytes. Overflow destroys the
 * request instead of draining the remainder; callers must not keep reading
 * the request afterwards. With objectOnly, non-JSON-object payloads also
 * yield null.
 */
export async function readJsonBody(
  req: IncomingMessage,
  opts: { maxBytes?: number; objectOnly?: boolean } = {},
): Promise<unknown | null> {
  const maxBytes = opts.maxBytes ?? DEFAULT_JSON_BODY_MAX_BYTES
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > maxBytes) {
      req.destroy()
      return null
    }
    chunks.push(buffer)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
  if (opts.objectOnly === true && (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))) return null
  return parsed
}

/** Narrow a value to a JSON object, or undefined when it is not one. */
export function asJsonObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * Write one JSON response. Default headers are the family defaults
 * (content-type and referrer-policy); caller headers are appended or
 * override them.
 */
export function writeJson(res: ServerResponse, status: number, body: unknown, headers?: OutgoingHttpHeaders): void {
  res.writeHead(status, headers === undefined ? { ...JSON_HEADERS } : { ...JSON_HEADERS, ...headers })
  res.end(JSON.stringify(body))
}
