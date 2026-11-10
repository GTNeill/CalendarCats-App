// ── Calendar feed sources ────────────────────────────────────────────────────
//
// Which calendars the site reads used to be hardcoded in api/index.ts, so
// adding or swapping a source meant a code change and a deploy. The WordPress
// plugin has always exposed these under Settings → CalendarCats, and this
// brings the site itself to parity.
//
// The line format is deliberately identical to the plugin's textarea
// (includes/class-wpcc-settings.php::get_feeds) so the two can be copied
// between each other verbatim:
//
//   https://example.com/events.ics | Village Events
//   abc123@group.calendar.google.com | Ward Events
//   # blank lines and comments are ignored
//
// A bare value with no scheme is treated as a Google Calendar id and expanded
// to its public iCal URL, exactly as the plugin does.
//
// An optional third field after a second pipe names the public *page* that
// presents this calendar — the About popup links here, not to the raw feed.
// A Google Calendar feed has no page of its own (it's just data), so give
// one explicitly; a Squarespace/RSS feed's own URL is usually already the
// events page, so it's used automatically when this field is left off:
//
//   abc123@group.calendar.google.com | Ward Events | https://example.org/events/
//   https://example.org/events/rss | Example Org | https://example.org/events
//
// Three kinds of source, in descending order of data quality:
//   ics          — any .ics feed, or a bare Google Calendar id.
//   squarespace  — no .ics, but ?format=json gives full structured events.
//   rss          — Wild Apricot and similar, which publish no export at all.
//                  Start time only: the feed carries no end or location.

/** Google's public iCal URL template, used when a feed is given as a calendar id. */
const GCAL_ICAL = "https://calendar.google.com/calendar/ical/%s/public/basic.ics";

const GCAL_ICAL_RE =
  /^https?:\/\/(?:www\.)?calendar\.google\.com\/calendar\/ical\/([^/]+)\/public\/basic\.ics/i;

export interface IcsFeed {
  /** Fully-resolved .ics URL to fetch. */
  url: string;
  /** Display name, surfaced as the event's organizer. */
  name: string;
  /**
   * The Google Calendar id, when this feed is a Google calendar. Needed to
   * build per-event calendar.google.com links; empty for other providers,
   * which makes buildGCalLink() correctly return no link.
   */
  gcalId: string;
  /**
   * The public website page that presents this calendar (e.g. the org's
   * "/events" page it's embedded on), for the About popup's "Visit site"
   * link. Empty when not configured — an .ics feed has no page of its own,
   * so this must be set explicitly via the third pipe field.
   */
  pageUrl: string;
}

export interface SquarespaceFeed {
  url: string;
  name: string;
  /** Defaults to `url` itself: a Squarespace feed's URL is already its events page. */
  pageUrl: string;
}

export interface RssFeed {
  url: string;
  name: string;
  /** Empty unless set via the third pipe field — an RSS feed URL is rarely the page itself. */
  pageUrl: string;
}

export interface FeedSettings {
  /** Raw textarea contents, preserved verbatim so comments and order survive a round-trip. */
  ics: string;
  squarespace: string;
  rss: string;
}

/** The sources that were hardcoded before this was configurable. */
export const DEFAULT_FEEDS: FeedSettings = {
  ics:
    "c_50dc8883383193a9f6ba4d86cd23a836978e1d42028f0e7bb263955d5539912c@group.calendar.google.com | 40th Ward Events | https://40thward.org/events/\n" +
    "c_05dba706bb25f28f63bfc0b821c9f8d5e29d9f2b105e78949388b675eb801572@group.calendar.google.com | 40th Ward Community | https://40thward.org/events/",
  squarespace:
    "https://www.thegreaterrockwell.org/events | Greater Rockwell Organization\n" +
    "https://www.heartoflincolnsquare.org/events | Heart of Lincoln Square",
  rss:
    "https://www.dankhaus.com/events/rss | DANK Haus German American Cultural Center | https://www.dankhaus.com/events",
};

/**
 * Split a textarea into `{ value, name, pageUrl }`, dropping blanks and
 * # comments. `pageUrl` is the optional third pipe-delimited field (the
 * public page that presents the calendar), blank when omitted.
 */
function parseLines(raw: string): { value: string; name: string; pageUrl: string }[] {
  const out: { value: string; name: string; pageUrl: string }[] = [];
  for (const line of (raw ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const parts = trimmed.split("|").map(p => p.trim());
    const value = parts[0] ?? "";
    const name = parts[1] ?? "";
    const pageUrl = parts[2] ?? "";
    if (!value) continue;
    out.push({ value, name, pageUrl });
  }
  return out;
}

/**
 * Resolve one feed value to a URL plus, when applicable, its Google Calendar
 * id. Mirrors the plugin's normalize_feed().
 */
export function normalizeFeed(value: string): { url: string; gcalId: string } {
  let v = (value ?? "").trim();
  if (!v) return { url: "", gcalId: "" };

  // webcal:// is just https:// for our purposes.
  if (/^webcal:\/\//i.test(v)) v = `https://${v.slice(9)}`;

  if (/^https?:\/\//i.test(v)) {
    // Recover the calendar id from a Google iCal URL so event deep-links
    // keep working when a feed is pasted as a full URL rather than an id.
    const m = v.match(GCAL_ICAL_RE);
    let gcalId = "";
    if (m) {
      try { gcalId = decodeURIComponent(m[1]); } catch { gcalId = m[1]; }
    }
    return { url: v, gcalId };
  }

  // Anything else is treated as a Google Calendar id. Reject values with
  // whitespace or slashes, which cannot be one.
  if (/^[^\s/\\]+$/.test(v)) {
    return { url: GCAL_ICAL.replace("%s", encodeURIComponent(v)), gcalId: v };
  }

  return { url: "", gcalId: "" };
}

/** A pageUrl field is only kept when it actually parses as an http(s) URL. */
function validPageUrl(pageUrl: string): string {
  return /^https?:\/\//i.test(pageUrl) ? pageUrl : "";
}

/** Parse the ICS textarea into fetchable feeds. Invalid lines are skipped. */
export function parseIcsFeeds(raw: string): IcsFeed[] {
  const feeds: IcsFeed[] = [];
  for (const { value, name, pageUrl } of parseLines(raw)) {
    const { url, gcalId } = normalizeFeed(value);
    if (!url) continue;
    feeds.push({ url, name: name || "Calendar", gcalId, pageUrl: validPageUrl(pageUrl) });
  }
  return feeds;
}

/**
 * Parse the Squarespace textarea. These must be real http(s) URLs of an
 * events collection page — there is no id shorthand to expand. The feed URL
 * itself is already that events page, so it doubles as pageUrl unless a
 * different one is given explicitly.
 */
export function parseSquarespaceFeeds(raw: string): SquarespaceFeed[] {
  const feeds: SquarespaceFeed[] = [];
  for (const { value, name, pageUrl } of parseLines(raw)) {
    if (!/^https?:\/\//i.test(value)) continue;
    feeds.push({ url: value, name: name || "Events", pageUrl: validPageUrl(pageUrl) || value });
  }
  return feeds;
}

/**
 * Parse the RSS textarea. Like Squarespace these must be real http(s) URLs —
 * the feed path varies by platform (Wild Apricot uses /events/rss), so there
 * is nothing to expand. Unlike Squarespace the feed URL is rarely the page
 * itself (e.g. .../events/rss vs .../events), so pageUrl stays blank unless
 * given explicitly.
 */
export function parseRssFeeds(raw: string): RssFeed[] {
  const feeds: RssFeed[] = [];
  for (const { value, name, pageUrl } of parseLines(raw)) {
    if (!/^https?:\/\//i.test(value)) continue;
    feeds.push({ url: value, name: name || "Events", pageUrl: validPageUrl(pageUrl) });
  }
  return feeds;
}

/** Split one raw line into its up-to-three pipe fields, blank if absent. */
function lineFields(trimmed: string): { value: string; pageUrl: string } {
  const parts = trimmed.split("|").map(p => p.trim());
  return { value: parts[0] ?? "", pageUrl: parts[2] ?? "" };
}

/**
 * Per-line validation for the admin UI, so a typo is reported on save
 * instead of silently dropping a calendar.
 */
export function validateFeeds(settings: FeedSettings): string[] {
  const errors: string[] = [];

  (settings.ics ?? "").split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const { value, pageUrl } = lineFields(trimmed);
    if (!value) return;
    if (!normalizeFeed(value).url) {
      errors.push(`Calendar feeds, line ${i + 1}: "${value}" is not a URL or a Google Calendar id.`);
    }
    if (pageUrl && !/^https?:\/\//i.test(pageUrl)) {
      errors.push(`Calendar feeds, line ${i + 1}: page link "${pageUrl}" must be a full http(s) URL.`);
    }
  });

  (settings.squarespace ?? "").split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const { value, pageUrl } = lineFields(trimmed);
    if (!value) return;
    if (!/^https?:\/\//i.test(value)) {
      errors.push(`Squarespace sources, line ${i + 1}: "${value}" must be a full http(s) URL.`);
    }
    if (pageUrl && !/^https?:\/\//i.test(pageUrl)) {
      errors.push(`Squarespace sources, line ${i + 1}: page link "${pageUrl}" must be a full http(s) URL.`);
    }
  });

  (settings.rss ?? "").split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const { value, pageUrl } = lineFields(trimmed);
    if (!value) return;
    if (!/^https?:\/\//i.test(value)) {
      errors.push(`RSS feeds, line ${i + 1}: "${value}" must be a full http(s) URL.`);
    }
    if (pageUrl && !/^https?:\/\//i.test(pageUrl)) {
      errors.push(`RSS feeds, line ${i + 1}: page link "${pageUrl}" must be a full http(s) URL.`);
    }
  });

  return errors;
}
