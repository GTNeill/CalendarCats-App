// ── Safe, bounded, cached fetching of third-party feeds ──────────────────────
//
// Feed URLs are typed into the admin panel, so the server fetches whatever an
// admin (or a compromised admin session) points it at. Without guards that is
// a server-side request forgery hole: a feed URL of http://169.254.169.254/…
// or http://localhost:… makes the server read its own network and surface the
// response as "calendar" data. This module is the single place feeds are
// fetched, and it:
//
//   - allows only http(s) to public addresses (literal IPs and DNS results are
//     both checked; redirects are followed by hand so every hop is re-checked)
//   - gives up after a timeout instead of hanging a request forever
//   - refuses bodies over a size cap, checked while streaming, so a huge or
//     endless response can't exhaust memory
//   - keeps successful bodies briefly in memory and shares one in-flight
//     request between concurrent callers, so a page view no longer costs one
//     upstream fetch per feed (the WordPress plugin caches the same way)
//
// Set ALLOW_PRIVATE_FEEDS=1 to switch the address check off (local testing
// against a dev server only).

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const MAX_FEED_BYTES = 5 * 1024 * 1024;
export const FEED_TIMEOUT_MS = 20_000;
export const FEED_CACHE_MS = 5 * 60 * 1000;
const MAX_REDIRECTS = 5;
/** Bound on distinct cached URLs; feeds are admin-configured so this is generous. */
const MAX_CACHE_ENTRIES = 100;

/** True for loopback, private, link-local, CGNAT, multicast and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return true;
    // IPv4-mapped (::ffff:a.b.c.d or ::ffff:7f00:1) — judge by the embedded v4.
    const dotted = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isPrivateAddress(dotted[1]);
    const hex = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16);
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith("ff");
  }
  return true; // not an IP at all — never treat as safe
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`"${raw}" is not a valid URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`only http(s) feeds are allowed, got ${url.protocol}`);
  }
  if (process.env.ALLOW_PRIVATE_FEEDS === "1") return url;

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new Error(`feed host "${host}" is not a public address`);
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error(`feed host "${host}" is not a public address`);
    return url;
  }
  const addrs = await lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some(a => isPrivateAddress(a.address))) {
    throw new Error(`feed host "${host}" resolves to a non-public address`);
  }
  return url;
}

async function readCapped(res: Response, max: number): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) throw new Error(`response too large (${declared} bytes)`);
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new Error(`response too large (over ${max} bytes)`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** What callers need from a feed response; a plain object so it can be cached and re-read. */
export interface FeedResponse {
  ok: boolean;
  status: number;
  contentType: string;
  text: string;
}

/** Fetch a URL as text with the guards above; the body is read and size-capped. */
export async function safeFetchText(
  rawUrl: string,
  headers: Record<string, string> = {},
): Promise<FeedResponse> {
  const signal = AbortSignal.timeout(FEED_TIMEOUT_MS);
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(current);
    const res = await fetch(url, { headers, redirect: "manual", signal });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, url).toString();
      await res.body?.cancel();
      continue;
    }
    const text = res.ok ? await readCapped(res, MAX_FEED_BYTES) : "";
    return { ok: res.ok, status: res.status, contentType: res.headers.get("content-type") ?? "", text };
  }
  throw new Error("too many redirects");
}

// ── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry { at: number; value: FeedResponse }
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<FeedResponse>>();

/** Drop every cached body, so the next request refetches (call after feeds change). */
export function clearFeedCache(): void {
  cache.clear();
}

/**
 * safeFetchText with a short in-memory cache. Only successful (2xx) responses
 * are kept, so a feed that fails once is retried on the next request.
 */
export async function cachedFetchText(
  rawUrl: string,
  headers: Record<string, string> = {},
  ttlMs = FEED_CACHE_MS,
): Promise<FeedResponse> {
  const key = rawUrl;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;

  let pending = inflight.get(key);
  if (!pending) {
    pending = safeFetchText(rawUrl, headers)
      .then(value => {
        if (value.ok) {
          if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
          cache.set(key, { at: Date.now(), value });
        }
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}
