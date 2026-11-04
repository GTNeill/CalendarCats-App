// Run: bun test packages/web/src/api/lib/safeFetch.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cachedFetchText, clearFeedCache, isPrivateAddress, safeFetchText } from "./safeFetch";

describe("isPrivateAddress", () => {
  test.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "not-an-ip",
  ])("%s is private", ip => expect(isPrivateAddress(ip)).toBe(true));

  test.each(["8.8.8.8", "172.32.0.1", "142.250.80.46", "2606:4700:4700::1111"])(
    "%s is public", ip => expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe("safeFetchText refuses unsafe targets", () => {
  test.each([
    "http://127.0.0.1/x.ics", "http://localhost:3000/", "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/", "file:///etc/passwd", "ftp://example.com/x", "not a url",
  ])("%s", async url => {
    await expect(safeFetchText(url)).rejects.toThrow();
  });
});

// Local server, reached with the address check switched off, to exercise the
// timeout/size/redirect/cache paths.
describe("fetching behaviour", () => {
  let server: ReturnType<typeof Bun.serve>;
  let hits = 0;
  const base = () => `http://127.0.0.1:${server.port}`;
  beforeAll(() => {
    process.env.ALLOW_PRIVATE_FEEDS = "1";
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const p = new URL(req.url).pathname;
        hits++;
        if (p === "/ok") return new Response("BEGIN:VCALENDAR");
        if (p === "/big") return new Response("x".repeat(6 * 1024 * 1024));
        if (p === "/redir") return new Response(null, { status: 302, headers: { location: "/ok" } });
        if (p === "/loop") return new Response(null, { status: 302, headers: { location: "/loop" } });
        if (p === "/500") return new Response("no", { status: 500 });
        return new Response("nf", { status: 404 });
      },
    });
  });
  afterAll(() => { server.stop(true); delete process.env.ALLOW_PRIVATE_FEEDS; });

  test("returns the body", async () => {
    expect((await safeFetchText(`${base()}/ok`)).text).toBe("BEGIN:VCALENDAR");
  });
  test("follows redirects", async () => {
    expect((await safeFetchText(`${base()}/redir`)).text).toBe("BEGIN:VCALENDAR");
  });
  test("gives up on redirect loops", async () => {
    await expect(safeFetchText(`${base()}/loop`)).rejects.toThrow(/redirect/);
  });
  test("rejects oversized bodies", async () => {
    await expect(safeFetchText(`${base()}/big`)).rejects.toThrow(/too large/);
  });
  test("caches successes and shares in-flight requests", async () => {
    clearFeedCache(); hits = 0;
    await Promise.all([cachedFetchText(`${base()}/ok`), cachedFetchText(`${base()}/ok`)]);
    await cachedFetchText(`${base()}/ok`);
    expect(hits).toBe(1);
    clearFeedCache();
    await cachedFetchText(`${base()}/ok`);
    expect(hits).toBe(2);
  });
  test("does not cache failures", async () => {
    clearFeedCache(); hits = 0;
    expect((await cachedFetchText(`${base()}/500`)).ok).toBe(false);
    await cachedFetchText(`${base()}/500`);
    expect(hits).toBe(2);
  });
  test("redirect to a private host is blocked when the check is on", async () => {
    delete process.env.ALLOW_PRIVATE_FEEDS;
    try { await expect(safeFetchText(`${base()}/ok`)).rejects.toThrow(); }
    finally { process.env.ALLOW_PRIVATE_FEEDS = "1"; }
  });
});
