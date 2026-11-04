// ── Events RSS connector (Wild Apricot and friends) ──────────────────────────
//
// Some neighborhood orgs run on Wild Apricot, which — unlike Google Calendar
// and unlike Squarespace — exposes no machine-readable event export at all.
// Probing dankhaus.com confirmed it: `?format=ical`, `/events/ical`,
// `/events.ics` and the `Sys/` paths all just return the rendered HTML page.
//
// What Wild Apricot does publish is an events RSS feed at `/events/rss`:
//
//   <item>
//     <pubDate>Fri, 11 Sep 2026 00:00:00 GMT</pubDate>
//     <title>Neighborhood Nights 2026 (Thursday, September 10, 2026)</title>
//     <description>...HTML...</description>
//     <link>https://dankhaus.com/event-6482571</link>
//   </item>
//
// Two things make that usable as a calendar source:
//
//   1. pubDate is the event START, in UTC — not the publication date. Verified
//      against the live feed: "Thursday, September 10" carries pubDate
//      Sep 11 00:00 GMT, which is Sep 10 7:00 PM Chicago. All-day entries land
//      exactly on local midnight.
//   2. The title carries the authoritative event date in parentheses, which we
//      use to cross-check pubDate (see below).
//
// What the feed does NOT carry is an end time or a location, so events from
// here are start-only. That is deliberate: inventing a duration would put a
// wrong end time on a public calendar, which is worse than showing none.
//
// Recurring series repeat the same <link>/<guid> for every occurrence, so the
// event id must include the date or the whole series collapses into one row.

import { toChicagoISO } from "../lib/time";
import { htmlToText } from "../lib/html";
import { cachedFetchText } from "../lib/safeFetch";

export interface RssSource {
  /** Full URL of the events RSS feed, e.g. "https://www.dankhaus.com/events/rss" */
  url: string;
  /** Display name shown as the event's organizer in the UI. */
  name: string;
}

interface RssItem {
  title: string;
  link: string;
  guid: string;
  description: string;
  pubDate: string;
}

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/**
 * Wild Apricot appends the event date to every title:
 *   "Blutspende | Blood Drive (Saturday, September 19, 2026)"
 * Pull it out so the title can be cleaned and the date cross-checked.
 */
export function parseTitleDate(title: string): { clean: string; date: string } {
  const m = title.match(
    /\s*\((?:[A-Za-z]+,\s*)?([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\)\s*$/,
  );
  if (!m) return { clean: title.trim(), date: "" };

  const month = MONTHS[m[1].toLowerCase()];
  if (month === undefined) return { clean: title.trim(), date: "" };

  const day = Number(m[2]);
  const year = Number(m[3]);
  if (!(day >= 1 && day <= 31)) return { clean: title.trim(), date: "" };

  const date =
    `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { clean: title.slice(0, m.index).trim(), date };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

/** Read one child tag out of an <item> block, unwrapping CDATA. */
function tag(block: string, name: string): string {
  const m = block.match(
    new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"),
  );
  if (!m) return "";
  const raw = m[1].trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return cdata ? cdata[1].trim() : decodeEntities(raw);
}

/**
 * Minimal RSS 2.0 item extractor. Hand-rolled to stay dependency-free, the
 * same way parseICS() is — these feeds are machine-generated and shallow.
 */
export function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const re = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    items.push({
      title: tag(block, "title"),
      link: tag(block, "link"),
      guid: tag(block, "guid"),
      description: tag(block, "description"),
      pubDate: tag(block, "pubDate"),
    });
  }
  return items;
}

function originOf(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).origin;
  } catch {
    return "";
  }
}

/** Stable-ish suffix for the event id: the numeric event id when there is one. */
function idPart(item: RssItem): string {
  const ref = item.guid || item.link;
  const m = ref.match(/event-(\d+)/i);
  if (m) return m[1];
  return ref.replace(/^https?:\/\//i, "").replace(/[^\w.-]+/g, "-").slice(0, 80);
}

export function mapRssItem(item: RssItem, source: RssSource): any | null {
  if (!item.title && !item.link) return null;

  const { clean, date: titleDate } = parseTitleDate(item.title);

  const pub = item.pubDate ? new Date(item.pubDate) : null;
  const pubValid = pub !== null && !Number.isNaN(pub.getTime());
  // pubDate is UTC; the calendar works in Chicago local wall-clock throughout.
  const localISO = pubValid ? toChicagoISO(pub as Date) : "";
  const pubDay = localISO.slice(0, 10);
  const pubTime = localISO.slice(11);

  let day = "";
  let time = "";

  if (pubValid && (!titleDate || titleDate === pubDay)) {
    // Normal case: pubDate agrees with the date printed in the title, so its
    // time component is trustworthy. Local midnight means an all-day entry.
    day = pubDay;
    time = pubTime === "00:00:00" ? "" : pubTime;
  } else if (titleDate) {
    // They disagree, which means pubDate is a real publication date on this
    // feed rather than the start. The title is authoritative for the day, and
    // with no trustworthy time the event becomes all-day rather than wrong.
    day = titleDate;
    time = "";
  } else if (pubValid) {
    day = pubDay;
    time = pubTime === "00:00:00" ? "" : pubTime;
  } else {
    // No usable date at all — skip rather than place it at the epoch.
    return null;
  }

  const origin = originOf(source.url);
  const link = item.link || source.url;

  return {
    // Namespaced so it can never collide with an ICS UID or a Squarespace id,
    // and dated so a recurring series stays one row per occurrence.
    id: `rss:${origin}:${idPart(item)}:${day}`,
    summary: clean || "(no title)",
    start: time ? { dateTime: `${day}T${time}` } : { date: day },
    // No end at all: this feed carries none, and guessing a duration would
    // publish a wrong finish time. Downstream this becomes end: "", which
    // fmtDuration() and the grid's layout fallback already handle, and which
    // the time labels now render start-only (no dangling dash).
    end: undefined,
    location: "",
    description: htmlToText(item.description),
    organizer: { displayName: source.name },
    status: "CONFIRMED",
    htmlLink: link,
  };
}

/**
 * Fetch one events RSS feed, normalized to the same raw shape parseICS()
 * emits, filtered to [timeMin, timeMax].
 */
export async function fetchRssEvents(
  source: RssSource,
  timeMin: Date,
  timeMax: Date,
): Promise<any[]> {
  const res = await cachedFetchText(source.url, {
    "User-Agent": "CommunityCalendar/1.0 (+https://40thward.org)",
    Accept: "application/rss+xml, application/xml, text/xml",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const ct = res.contentType;
  const xml = res.text;
  if (!/xml/i.test(ct) && !/<rss[\s>]|<feed[\s>]/i.test(xml)) {
    // Wild Apricot answers with the rendered page for unsupported paths, so
    // non-XML here means this URL is not an RSS feed.
    throw new Error(`expected RSS, got "${ct}" — is ${source.url} an events RSS feed?`);
  }

  const out: any[] = [];
  const seen = new Set<string>();
  for (const item of parseRss(xml)) {
    const ev = mapRssItem(item, source);
    if (!ev) continue;

    const startStr = ev.start.dateTime ?? `${ev.start.date}T00:00:00`;
    const startMs = new Date(`${startStr}Z`).getTime();
    if (Number.isNaN(startMs)) continue;
    // Compared as wall-clock against the window, matching how the ICS path
    // filters; an exact hour either side of the boundary does not matter here.
    if (startMs < timeMin.getTime() - 86_400_000 || startMs > timeMax.getTime() + 86_400_000) continue;
    if (seen.has(ev.id)) continue;

    seen.add(ev.id);
    out.push(ev);
  }
  return out;
}
