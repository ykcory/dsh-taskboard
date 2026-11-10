/**
 * Shared JSON body/response helpers for the host route family: one lenient
 * bounded body reader, one JSON object narrow, and one JSON writer.
 * @module taskboard/host/http
 */
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
/**
 * Lenient bounded body reader: parse a request body as JSON, or null on an
 * empty body, invalid JSON, or a body past maxBytes. Overflow destroys the
 * request instead of draining the remainder; callers must not keep reading
 * the request afterwards. With objectOnly, non-JSON-object payloads also
 * yield null.
 */
export declare function readJsonBody(req: IncomingMessage, opts?: {
    maxBytes?: number;
    objectOnly?: boolean;
}): Promise<unknown | null>;
/** Narrow a value to a JSON object, or undefined when it is not one. */
export declare function asJsonObject(value: unknown): Record<string, unknown> | undefined;
/**
 * Write one JSON response. Default headers are the family defaults
 * (content-type and referrer-policy); caller headers are appended or
 * override them.
 */
export declare function writeJson(res: ServerResponse, status: number, body: unknown, headers?: OutgoingHttpHeaders): void;
