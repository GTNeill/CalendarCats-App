// ── Squarespace events connector ─────────────────────────────────────────────
//
// Squarespace event collections ("events-stacked") do NOT expose a
// collection-level .ics feed — `/events?format=ical` just returns the HTML
// page, and `?format=rss` carries no start times (only pubDate). What they do
// expose is `/events?format=json`, which returns fully structured events:
//
//   {
//     upcoming:   [ item, ... ],          // future events, newest-last
//     past:       [ item, ... ],          // past events, newest-first
//     pagination: { nextPage, nextPageUrl, nextPageOffset }
//   }
//
// Each item carries `startDate` / `endDate` as epoch milliseconds, a
// structured `location` object, `title`, `excerpt` (HTML), and `fullUrl`.
//
// Recurring Squarespace events are stored as separate items with their own
// ids and URLs, so there is no RRULE expansion to do here — unlike the ICS
// path, one item is exactly one occurrence.
//
// This connector normalizes those items into the same raw event shape that
// parseICS() emits, so everything downstream (categorization, shaping, the
// UI) treats Squarespace sources identically to Google iCal feeds.

import { toChicagoISO } from "../lib/time";
import { htmlToText } from "../lib/html";
import { cachedFetchText } from "../lib/safeFetch";

export interface SquarespaceSource {
  /** Full URL of the events collection page, e.g. "https://example.org/events" */
  url: string;
  /** Display name shown as the event's organizer in the UI. */
  name: string;
}

interface SquarespaceLocation {
  addressTitle?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressCountry?: string;
}

interface SquarespaceItem {
  id?: string;
  title?: string;
  fullUrl?: string;
  startDate?: number;
  endDate?: number;
  excerpt?: string;
  body?: string;
  location?: SquarespaceLocation;
  recordTypeLabel?: string;
}

interface SquarespaceCollectionResponse {
  upcoming?: SquarespaceItem[];
  past?: SquarespaceItem[];
  items?: SquarespaceItem[];
  pagination?: { nextPage?: boolean; nextPageUrl?: string; nextPageOffset?: number };
}

// Past events are paginated 30 at a time, newest first. We only ever walk
// backwards far enough to cover the requested window, and never more than
// this many pages — a guard against an unbounded crawl of a site with years
// of history behind it.
const MAX_PAST_PAGES = 6;

function formatLocation(loc?: SquarespaceLocation): string {
  if (!loc) return "";
  return [loc.addressTitle, loc.addressLine1, loc.addressLine2]
    .map(p => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

// A Squarespace "all day" event is entered as midnight-to-midnight; there is
// no explicit flag in the JSON. Treat a run that starts at local midnight and
// lasts a whole number of days as all-day so it renders like an ICS
// VALUE=DATE event instead of showing a spurious "12:00 AM" time.
function looksAllDay(startISO: string, endISO: string): boolean {
  if (!startISO.endsWith("T00:00:00") || !endISO.endsWith("T00:00:00")) return false;
  return startISO.slice(0, 10) !== endISO.slice(0, 10) || startISO === endISO;
}

function originOf(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).origin;
  } catch {
    return "";
  }
}

function mapItem(item: SquarespaceItem, source: SquarespaceSource): any | null {
  const startMs = item.startDate;
  const endMs = item.endDate;
  if (typeof startMs !== "number" || Number.isNaN(startMs)) return null;

  const start = new Date(startMs);
  // A missing/invalid end is treated as a one-hour event rather than dropped —
  // better a slightly wrong duration than a silently missing community event.
  const end = typeof endMs === "number" && endMs > startMs ? new Date(endMs) : new Date(startMs + 3600_000);

  const startISO = toChicagoISO(start);
  const endISO = toChicagoISO(end);
  const allDay = looksAllDay(startISO, endISO);

  const origin = originOf(source.url);
  const link = item.fullUrl
    ? (item.fullUrl.startsWith("http") ? item.fullUrl : `${origin}${item.fullUrl}`)
    : source.url;

  return {
    // Namespaced so a Squarespace id can never collide with an ICS UID.
    id: `sqsp:${origin}:${item.id ?? startMs}`,
    summary: (item.title ?? "").trim() || "(no title)",
    start: allDay ? { date: startISO.slice(0, 10) } : { dateTime: startISO },
    end: allDay ? { date: endISO.slice(0, 10) } : { dateTime: endISO },
    location: formatLocation(item.location),
    description: htmlToText(item.excerpt ?? item.body ?? ""),
    organizer: { displayName: source.name },
    status: "CONFIRMED",
    htmlLink: link,
  };
}

async function fetchPage(url: string): Promise<SquarespaceCollectionResponse> {
  const res = await cachedFetchText(url, {
    "User-Agent": "CalendarCats/1.0 (+https://40thward.org)",
    Accept: "application/json",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.contentType;
  if (!ct.includes("json")) {
    // Squarespace answers with the rendered HTML page when a format isn't
    // supported, so a non-JSON content type means this URL is not an events
    // collection (wrong path, or the page was deleted/renamed).
    throw new Error(`expected JSON, got "${ct}" — is ${url} an events collection?`);
  }
  return JSON.parse(res.text) as SquarespaceCollectionResponse;
}

function withJsonFormat(url: string): string {
  return url.includes("?") ? `${url}&format=json` : `${url}?format=json`;
}

/**
 * Fetch events from one Squarespace events collection, normalized to the same
 * raw shape parseICS() produces, filtered to [timeMin, timeMax].
 */
export async function fetchSquarespaceEvents(
  source: SquarespaceSource,
  timeMin: Date,
  timeMax: Date,
): Promise<any[]> {
  const origin = originOf(source.url);
  const out: any[] = [];
  const seen = new Set<string>();

  const collect = (items: SquarespaceItem[] | undefined) => {
    for (const item of items ?? []) {
      const ev = mapItem(item, source);
      if (!ev) continue;
      const startMs = new Date(item.startDate as number).getTime();
      // A missing/invalid endDate falls back to the same 1-hour default
      // mapItem() uses, so a multi-day event overlapping the window isn't
      // dropped just because it started before timeMin.
      const endMs = typeof item.endDate === "number" && item.endDate > startMs ? item.endDate : startMs + 3600_000;
      if (startMs > timeMax.getTime() || endMs < timeMin.getTime()) continue;
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      out.push(ev);
    }
  };

  const first = await fetchPage(withJsonFormat(source.url));

  // `upcoming` holds every future event in one shot (it isn't paginated), so
  // a forward-looking window is fully covered by page one.
  collect(first.upcoming);
  collect(first.items);
  collect(first.past);

  // Only walk back through `past` when the window actually reaches further
  // back than this page does. `nextPageOffset` is the epoch-ms cursor of the
  // oldest item returned so far, which makes that check exact.
  let page = first;
  for (let i = 0; i < MAX_PAST_PAGES; i++) {
    const pg = page.pagination;
    if (!pg?.nextPage || !pg.nextPageUrl) break;
    const oldestSoFar = pg.nextPageOffset;
    if (typeof oldestSoFar === "number" && oldestSoFar <= timeMin.getTime()) break;

    const nextUrl = pg.nextPageUrl.startsWith("http") ? pg.nextPageUrl : `${origin}${pg.nextPageUrl}`;
    // The cursor comes from the remote site; never let it steer us to another host.
    if (originOf(nextUrl) !== origin) break;
    page = await fetchPage(withJsonFormat(nextUrl));
    collect(page.past);
    collect(page.items);
  }

  return out;
}
