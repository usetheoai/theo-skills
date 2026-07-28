import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

import {
  type WebhookSendRequest,
  type WebhookSendResponse,
  type WebhookSender,
} from '@usetheo/skills';

import {
  type AddressPolicy,
  type DnsResolver,
  publicAddressPolicy,
  resolveSafeAddresses,
} from './url-safety.js';

const DEFAULT_TIMEOUT_MS = 15_000;

export interface CreateHttpWebhookSenderOptions {
  /** DNS resolver used to validate + pin the target IP (DIP; tests stub it). */
  readonly resolver?: DnsResolver;
  readonly timeoutMs?: number;
  /** Egress address policy — defaults to public-only; tests inject allow-all. */
  readonly addressPolicy?: AddressPolicy;
}

/**
 * HTTP WebhookSender with SSRF-safe egress: it re-validates the target at send
 * time and PINS the TCP connection to the validated IP (custom `lookup`), so the
 * address checked is the address connected — closing the DNS-rebind TOCTOU that a
 * registration-time-only check leaves open. Redirects are NOT followed (node's
 * http(s) does not auto-follow), so a 3xx to an internal host cannot be chased.
 * The response body is drained, never buffered (no unbounded-read DoS).
 * Throws `UrlSafetyError` when the target resolves to a disallowed address.
 */
export function createHttpWebhookSender(opts: CreateHttpWebhookSenderOptions = {}): WebhookSender {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const policy = opts.addressPolicy ?? publicAddressPolicy;
  return {
    async send(req: WebhookSendRequest): Promise<WebhookSendResponse> {
      const { url, addresses } = await resolveSafeAddresses(req.url, opts.resolver, policy);
      // Pin to the first validated address. All addresses passed the policy, so any
      // is safe; we do not fail over across them (single-A is the common case —
      // multi-address happy-eyeballs failover is a deferred availability optimization,
      // not a correctness/security concern). A dead peer surfaces as a transient retry.
      const pinned = addresses[0];
      if (pinned === undefined) {
        throw new Error('no resolved address');
      }
      const family = isIP(pinned) === 6 ? 6 : 4;
      // Pin every connection attempt to the validated IP. Handle both callback
      // shapes: `all:true` expects an array of {address, family}, else a triple.
      const lookup = ((_hostname: string, options: unknown, cb: unknown): void => {
        if (typeof options === 'object' && options !== null && (options as { all?: boolean }).all === true) {
          (cb as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: pinned, family }]);
        } else {
          (cb as (e: null, a: string, f: number) => void)(null, pinned, family);
        }
      }) as unknown as LookupFunction;
      const body = Buffer.from(req.body);
      const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
      return await new Promise<WebhookSendResponse>((resolve, reject) => {
        const clientReq = requestFn(
          url,
          {
            method: 'POST',
            headers: { ...req.headers, 'content-length': String(body.byteLength) },
            lookup,
            servername: url.hostname, // keep SNI on the hostname for TLS cert validation
            timeout: timeoutMs,
          },
          (res) => {
            res.resume(); // drain without buffering (DoS-safe)
            res.on('end', () => {
              resolve({ status: res.statusCode ?? 0 });
            });
            res.on('error', reject);
          },
        );
        clientReq.on('error', reject);
        clientReq.on('timeout', () => {
          clientReq.destroy(new Error('webhook request timeout'));
        });
        clientReq.end(body);
      });
    },
  };
}
