/**
 * Loopback trust fence: socket address, Host header, and browser same-origin
 * markers.
 *
 * Semantics: RFC 5735 IPv4 127/8, ::1, IPv4-mapped ::ffff:127/8, localhost
 * hostnames, plus the browser same-origin markers (sec-fetch-site and Origin)
 * for the request-level fence.
 *
 * A reverse proxy in front of the host rewrites the Host header to its own
 * upstream literal and its socket is loopback by construction, so both halves
 * of the fence would then hold for a public request. Forwarding headers are
 * the signal that a hop stands in between: a request that carries
 * CF-Connecting-IP or X-Forwarded-For is answered through a proxy and is
 * never treated as a local one.
 * @module taskboard/host/loopback
 */
import type { IncomingMessage } from 'node:http';
/** IPv4 127/8 predicate (four decimal octets, first == 127). */
export declare function isIPv4Loopback(v4: string): boolean;
/** Whether a socket remote address names the loopback range (127/8, ::1, IPv4-mapped). */
export declare function isLoopbackAddress(address: string | undefined): boolean;
/** Whether a normalized URL hostname names the loopback authority (localhost, [::1], 127/8). */
export declare function isLoopbackHostname(hostname: string): boolean;
/**
 * Whether a reverse proxy stood between the client and this host: the request
 * carries CF-Connecting-IP or X-Forwarded-For. Either header is stamped by a
 * hop that forwards traffic, so the request did not originate on this machine.
 */
export declare function isProxiedRequest(request: IncomingMessage): boolean;
/**
 * Request-level trust fence: a loopback socket address AND a loopback Host
 * header, plus browser same-origin markers. The socket address is
 * authoritative for a direct connection; a request that carries a forwarding
 * header is refused outright.
 */
export declare function isLoopbackRequest(request: IncomingMessage): boolean;
