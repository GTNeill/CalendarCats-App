import { Hono } from 'hono';
import { cors } from "hono/cors";
import { RRuleSet, rrulestr } from "rrule";
import fs from "node:fs";
import path from "node:path";
import { auth, ADMIN_EMAIL_ALLOWLIST } from "./auth";
import { requireAdminAuth } from "./middleware/auth";
import { fetchSquarespaceEvents } from "./connectors/squarespace";
import { fetchRssEvents } from "./connectors/rss";
import { cachedFetchText, clearFeedCache } from "./lib/safeFetch";
import { DEFAULT_TZ, toChicagoISO } from "./lib/time";
import { dedupeEvents, type DedupeCluster } from "./lib/dedupe";
import {
  DEFAULT_FEEDS, parseIcsFeeds, parseSquarespaceFeeds, parseRssFeeds, validateFeeds,
  type FeedSettings,
} from "./lib/feeds";
import { FARMERS_MARKET_ICS, FARMERS_MARKET_FEED_NAME, FARMERS_MARKET_PAGE_URL } from "./lib/farmersMarket";

// ── Calendar sources ─────────────────────────────────────────────────────────
// Which calendars are read is configured at runtime and editable from
// /admincat, at parity with the WordPress plugin's Settings → Calendar Cats.
// The seed values and the line format live in lib/feeds.ts.
//
// Two kinds of source:
//   ics          — any .ics feed, or a bare Google Calendar id.
//   squarespace  — neighborhood orgs on Squarespace publish no usable .ics,
//                  but their events page exposes JSON at ?format=json (see
//                  connectors/squarespace.ts).
//   rss          — orgs on Wild Apricot publish no export at all, but do
//                  expose an events RSS feed whose pubDate is the event start
//                  (see connectors/rss.ts). Start time only, no end.
//
// The last two are supplemental: if one is down or changes shape the ward's
// own feeds must still render, so failures there are logged and skipped.

// ── Category persistence ──────────────────────────────────────────────────────
// DATA_DIR env var → set to a Railway volume mount path for persistence across deploys.
// Falls back to the local data/ folder alongside the source (dev + first deploy seed).
const _apiDir: string = (typeof (import.meta as any).dir === "string")
  ? (import.meta as any).dir
  : path.dirname(new URL(import.meta.url).pathname);
const _defaultDataDir = path.resolve(_apiDir, "../../data");
const DATA_DIR  = process.env.DATA_DIR ?? _defaultDataDir;
const DATA_FILE = path.join(DATA_DIR, "categories.json");
const SETTINGS_FILE = path.join(DATA_DIR, "site-settings.json");
const ICONS_DIR = path.join(DATA_DIR, "icons");
const FEEDS_FILE = path.join(DATA_DIR, "feeds.json");

// ── Site settings persistence (header/subtitle/footer link) ──────────────────
export interface SiteSettings {
  headerTitle: string;
  headerSubtitle: string;
  /** Left-hand footer credit line. Blank hides it. */
  footerText: string;
  footerLinkText: string;
  footerLinkUrl: string;
  /** Target of the "Submit Your Event" button. Blank hides the button. */
  submitEventUrl: string;
  /** Shown in the About popup for tech questions or requests to add a calendar. Blank hides it. */
  contactEmail: string;
}

const DEFAULT_SETTINGS: SiteSettings = {
  headerTitle: "Community Calendar",
  headerSubtitle: "Chicago Community Events Calendar",
  // Preserves the credit line that used to be hardcoded in the footer, so
  // existing deploys keep the same text until someone changes it.
  footerText: "Community Calendar — a neighbor-run project",
  footerLinkText: "40thward.org →",
  footerLinkUrl: "https://40thward.org/events/",
  // Preserves the URL that used to be hardcoded in the header, so existing
  // deploys keep the same button until someone changes it from /admincat.
  submitEventUrl: "https://airtable.com/appDK75qZXFYekjMt/pag5fZSZB51xIq4vi/form",
  contactEmail: "help@gneill.net",
};

let runtimeSettings: SiteSettings = DEFAULT_SETTINGS;

// ── Feed source persistence ──────────────────────────────────────────────────
function loadFeeds(): FeedSettings {
  try {
    const raw = fs.readFileSync(FEEDS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      ics: typeof parsed.ics === "string" ? parsed.ics : DEFAULT_FEEDS.ics,
      squarespace: typeof parsed.squarespace === "string" ? parsed.squarespace : DEFAULT_FEEDS.squarespace,
      rss: typeof parsed.rss === "string" ? parsed.rss : DEFAULT_FEEDS.rss,
    };
  } catch (e: any) {
    // A missing file is expected until something is saved from the admin
    // panel — the seeded defaults are correct until then.
    if (e?.code === "ENOENT") console.log(`[feeds] No feeds.json yet at ${FEEDS_FILE} — using seeded defaults.`);
    else console.error("Failed to load feeds.json, using previous/defaults:", e);
    return runtimeFeeds ?? DEFAULT_FEEDS;
  }
}

function saveFeeds(next: FeedSettings): void {
  fs.mkdirSync(path.dirname(FEEDS_FILE), { recursive: true });
  const tmpFile = `${FEEDS_FILE}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpFile, JSON.stringify(next, null, 2), "utf-8");
  fs.renameSync(tmpFile, FEEDS_FILE);
}

let runtimeFeeds: FeedSettings = DEFAULT_FEEDS;

function loadSettings(): SiteSettings {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch (e: any) {
    // A missing file is expected on a fresh volume — the defaults are correct
    // until something is saved from the admin panel. Only real errors are loud.
    if (e?.code === "ENOENT") console.log(`[settings] No site-settings.json yet at ${SETTINGS_FILE} — using defaults.`);
    else console.error("Failed to load site-settings.json, using defaults:", e);
    return runtimeSettings ?? DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: SiteSettings): void {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  const tmpFile = `${SETTINGS_FILE}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpFile, JSON.stringify(settings, null, 2), "utf-8");
  fs.renameSync(tmpFile, SETTINGS_FILE);
}

runtimeSettings = loadSettings();
runtimeFeeds = loadFeeds();

export interface CategoryDef {
  key: string;
  label: string;
  icon: string;
  color: string;
  group: string;       // "government" | "community"
  order: number;
  keywords: string[];  // plain strings used as regex alternates
  match: (title: string) => boolean;
  matchDescription: (text: string) => boolean;
}

function buildMatcher(keywords: string[]): (title: string) => boolean {
  if (keywords.length === 0) return () => true;   // "other" sentinel
  // Wrap each keyword in word boundaries so "walk" only matches the whole
  // word "walk", never a substring inside "sidewalk", "boardwalk", etc.
  // Safe for wildcard keywords too — e.g. "ward.*office" becomes
  // "\bward.*office\b", which additionally stops it from matching inside
  // "backward" or "officer".
  const rx = new RegExp(keywords.map(k => `\\b${k}\\b`).join("|"), "i");
  return (t: string) => rx.test(t);
}

// Keywords eligible for description matching must be BOTH:
//  1. Free of regex metacharacters (.*  .?  ^  $  ()  [] etc.) — a wildcard
//     tuned for a short title (e.g. "ward.*office") can otherwise span
//     across unrelated sentences in a long free-form description.
//  2. Multi-word phrases (contain a space) — a single generic word like
//     "groundbreaking" is too ambiguous out of context (it can appear as an
//     ordinary adjective, e.g. "a groundbreaking new musical", with no
//     relation to an actual groundbreaking ceremony). Multi-word phrases
//     like "ward night" or "american blues theater" are specific enough to
//     safely substring-match against full description text.
const REGEX_METACHAR = /[.*+?^${}()|[\]\\]/;

function buildDescriptionMatcher(keywords: string[]): (text: string) => boolean {
  const safe = keywords.filter(k => !REGEX_METACHAR.test(k) && k.trim().includes(" "));
  if (safe.length === 0) return () => false;
  // Word-boundary wrapped, same rationale as buildMatcher above.
  const rx = new RegExp(safe.map(k => `\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).join("|"), "i");
  return (text: string) => rx.test(text);
}

// Built-in safety net — used only if categories.json is ever unreadable/empty,
// so the site never crashes trying to categorize an event.
const FALLBACK_CATEGORY: CategoryDef = {
  key: "other",
  label: "Other",
  icon: "📌",
  color: "#5A5A5A",
  group: "community",
  order: 999,
  keywords: [],
  match: () => true,
  matchDescription: () => true,
};

// On a fresh volume DATA_FILE doesn't exist yet. This module is imported before
// server.ts gets a chance to seed it, so read the bundled copy directly rather
// than booting with just the fallback category.
const SEED_FILE = path.resolve(_apiDir, "../../data/categories.json");

function loadCategories(): CategoryDef[] {
  try {
    const file = fs.existsSync(DATA_FILE) ? DATA_FILE : SEED_FILE;
    const raw = fs.readFileSync(file, "utf-8");
    const parsed: Omit<CategoryDef, "match">[] = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("categories.json parsed to an empty/invalid list");
    }
    return parsed
      .sort((a, b) => a.order - b.order)
      .map(c => ({ ...c, match: buildMatcher(c.keywords), matchDescription: buildDescriptionMatcher(c.keywords) }));
  } catch (e) {
    console.error("Failed to load categories.json, keeping previous list:", e);
    // Never return an empty list — fall back to whatever was last loaded
    // successfully, or a single safe "other" category if this is the very
    // first load attempt.
    return runtimeCategories && runtimeCategories.length > 0
      ? runtimeCategories
      : [FALLBACK_CATEGORY];
  }
}

function saveCategories(cats: Omit<CategoryDef, "match">[]): void {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  // Write atomically: write to a temp file then rename, so a concurrent
  // read from another request never sees a half-written/truncated file.
  const tmpFile = `${DATA_FILE}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpFile, JSON.stringify(cats, null, 2), "utf-8");
  fs.renameSync(tmpFile, DATA_FILE);
}

// Initialize with the safe fallback first so loadCategories() always has
// something valid to reference in its catch branch, even on the very first call.
let runtimeCategories: CategoryDef[] = [FALLBACK_CATEGORY];
runtimeCategories = loadCategories();

function categorize(title: string, description: string = "", organizer: string = "", sources: string[] = []): CategoryDef {
  // Pass 0 — source/organizer override. Dedupe can replace a source-branded
  // title (e.g. "GRO Neighborhood Tree Walk" → "Neighborhood Tree Walk")
  // with a neighbor-feed title, so the source org a category is named after
  // would never match the title and the event lands in the wrong category.
  // Pin such events to their org's category before any keyword matching.
  const GRO_SOURCE = /greater rockwell|\bgro\b/i;
  const orgText = [organizer, ...sources].filter(Boolean).join("\n");
  if (orgText && GRO_SOURCE.test(orgText)) {
    const gro = runtimeCategories.find(c => c.key === "gro");
    if (gro) return gro;
  }
  // Pass 1 — title only (unchanged, highest-confidence match).
  for (const cat of runtimeCategories) {
    if (cat.key === "other") continue; // always last-resort
    if (cat.match(title)) return cat;
  }
  // Pass 2 — fallback to description, only for multi-word literal phrases
  // (see buildDescriptionMatcher for why). Catches events whose defining
  // detail — a producing company, venue, or organizer — only appears in
  // the description, not the title itself (e.g. "American Blues Theater").
  if (description) {
    for (const cat of runtimeCategories) {
      if (cat.key === "other") continue;
      if (cat.matchDescription(description)) return cat;
    }
  }
  // Guaranteed non-empty due to loadCategories() never returning [].
  return runtimeCategories[runtimeCategories.length - 1] ?? FALLBACK_CATEGORY;
}

// ── Fetch public iCal and parse events ───────────────────────────────────────
function buildGCalLink(uid: string, calId: string): string {
  if (!uid || !calId) return "";
  try {
    const shortId = uid.replace(/@google\.com$/, "");
    const payload = `${shortId} ${calId}`;
    const encoded = Buffer.from(payload).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    return `https://calendar.google.com/calendar/event?eid=${encoded}`;
  } catch {
    return "";
  }
}

/** The scheme+host of a feed URL, as a public "learn more about this source" link. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function icsVal(raw: string): string {
  return raw.replace(/\r?\n[ \t]/g, "").trim()
    .replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\\\/g, "\\");
}

function getField(block: string, key: string): string {
  const m = block.match(new RegExp(`^${key}[^:\r\n]*:([^\r\n]+(?:\r?\n[ \t][^\r\n]+)*)`, "m"));
  return m ? icsVal(m[1]) : "";
}

// Extract the TZID parameter from a raw ICS property line, e.g.
// "DTSTART;TZID=America/Chicago:20260601T150000" → "America/Chicago"
function getLineTzid(line: string): string | undefined {
  return line.match(/TZID=([^:;]+)/)?.[1];
}

// Convert a wall-clock date/time meant to represent a moment in `timeZone`
// into the correct absolute UTC Date, automatically accounting for whatever
// DST rules apply on that specific date (no hardcoded UTC offset).
function zonedWallClockToUTC(isoNaive: string, timeZone: string): Date {
  const asUTC = new Date(isoNaive + "Z");
  if (Number.isNaN(asUTC.getTime())) return asUTC;
  const tzStr  = asUTC.toLocaleString("en-US", { timeZone });
  const utcStr = asUTC.toLocaleString("en-US", { timeZone: "UTC" });
  const offsetMs = new Date(utcStr).getTime() - new Date(tzStr).getTime();
  return new Date(asUTC.getTime() + offsetMs);
}

// Builds the same "naive digits as if UTC" ISO string that rrule.js produces
// internally for floating DTSTART values — used only to match EXDATE/
// RECURRENCE-ID exclusions against RRULE occurrences, both in that same
// (not-yet-timezone-corrected) representation.
function naiveISOWithZ(raw: string): string {
  const val = raw.replace(/.*:/, "");
  const iso = `${val.slice(0,4)}-${val.slice(4,6)}-${val.slice(6,8)}T${val.slice(9,11)}:${val.slice(11,13)}:${val.slice(13,15)}.000Z`;
  return iso;
}

function parseICSDate(raw: string, tzid?: string): { date: Date; allDay: boolean } {
  if (!raw) return { date: new Date(0), allDay: false };
  const isAllDay = /VALUE=DATE/.test(raw) || /^\d{8}$/.test(raw.replace(/.*:/, ""));
  const val = raw.replace(/.*:/, "");
  if (isAllDay) {
    const iso = `${val.slice(0,4)}-${val.slice(4,6)}-${val.slice(6,8)}T00:00:00`;
    return { date: new Date(iso), allDay: true };
  }
  const d = val;
  const iso = `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${d.slice(9,11)}:${d.slice(11,13)}:${d.slice(13,15)}`;
  if (val.endsWith("Z")) {
    return { date: new Date(iso + "Z"), allDay: false };
  }
  // Floating/local time (e.g. "DTSTART;TZID=America/Chicago:20260601T150000")
  // — convert the wall-clock digits to the correct UTC instant using the
  // event's own TZID, falling back to Central time since that's this
  // calendar's home timezone.
  return { date: zonedWallClockToUTC(iso, tzid || DEFAULT_TZ), allDay: false };
}

function parseICS(ics: string, calendarName: string, calendarId: string, timeMin: Date, timeMax: Date): any[] {
  const events: any[] = [];
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  const blocks = unfolded.split(/BEGIN:VEVENT/);

  const overrides = new Map<string, Set<string>>();
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const recIdLine = block.match(/^RECURRENCE-ID[^\r\n]*/m)?.[0] ?? "";
    const recId = getField(block, "RECURRENCE-ID");
    if (!recId) continue;
    const uid = getField(block, "UID");
    if (!uid) continue;
    if (!overrides.has(uid)) overrides.set(uid, new Set());
    // Use the naive-digits representation so it matches occ.toISOString()
    // from rrule.js later, regardless of the RECURRENCE-ID's own TZID.
    overrides.get(uid)!.add(naiveISOWithZ(recIdLine || recId));
  }

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const recId = getField(block, "RECURRENCE-ID");
    const uid       = getField(block, "UID") || Math.random().toString(36);
    const summary   = getField(block, "SUMMARY") || "(no title)";
    const location  = getField(block, "LOCATION");
    const desc      = getField(block, "DESCRIPTION");
    const status    = getField(block, "STATUS") || "CONFIRMED";
    const url       = getField(block, "URL");
    const rruleStr  = getField(block, "RRULE");
    const exdateStr = getField(block, "EXDATE");

    const dtStartLine = block.match(/^DTSTART[^\r\n]*/m)?.[0] ?? "";
    const dtEndLine   = block.match(/^DTEND[^\r\n]*/m)?.[0] ?? "";
    const dtStartRaw  = dtStartLine.replace(/^DTSTART[^:]*:/, "").trim();
    const dtEndRaw    = dtEndLine.replace(/^DTEND[^:]*:/, "").trim();
    const dtStartTzid = getLineTzid(dtStartLine);
    const dtEndTzid   = getLineTzid(dtEndLine);

    const startParsed = parseICSDate(dtStartRaw, dtStartTzid);
    const endParsed   = parseICSDate(dtEndRaw, dtEndTzid);
    const duration    = endParsed.date.getTime() - startParsed.date.getTime();

    const makeEvent = (start: Date, end: Date, instanceUid: string) => {
      const isAllDay = startParsed.allDay;
      const startISO = isAllDay ? toChicagoISO(start).slice(0, 10) : toChicagoISO(start);
      const endISO   = isAllDay ? toChicagoISO(end).slice(0, 10)   : toChicagoISO(end);
      return {
        id: instanceUid,
        summary,
        start: isAllDay ? { date: startISO } : { dateTime: startISO },
        end:   isAllDay ? { date: endISO }   : { dateTime: endISO },
        location,
        description: desc,
        organizer: { displayName: calendarName },
        status,
        htmlLink: url || buildGCalLink(uid, calendarId),
      };
    };

    if (!rruleStr) {
      const start = startParsed.date;
      const end   = endParsed.date;
      // Overlap with the window, not just a start falling inside it — a
      // multi-day event that started before timeMin (e.g. an all-day event
      // spanning several days) must still show up on every day it covers.
      if (start <= timeMax && end >= timeMin) {
        events.push(makeEvent(start, end, uid + (recId ? "_" + recId : "")));
      }
      continue;
    }

    try {
      const excludedISOs = new Set<string>();
      if (exdateStr) {
        // EXDATE may contain multiple comma-separated values sharing the
        // property's TZID param.
        exdateStr.split(",").forEach(ex => {
          excludedISOs.add(naiveISOWithZ(ex.trim()));
        });
      }
      const ov = overrides.get(uid);
      if (ov) ov.forEach(iso => excludedISOs.add(iso));

      const ruleText = `DTSTART:${dtStartRaw.replace(/[TZ]/g, c => c)}\nRRULE:${rruleStr}`;
      const rule = rrulestr(ruleText, { forceset: true }) as RRuleSet;
      const occurrences = rule.between(
        new Date(timeMin.getTime() - 86400000),
        new Date(timeMax.getTime() + 86400000),
        true
      );

      for (const occ of occurrences) {
        if (excludedISOs.has(occ.toISOString())) continue;
        let start = occ;
        if (!dtStartRaw.endsWith("Z")) {
          // occ's ISO digits are the naive wall-clock time (rrule.js treats
          // floating DTSTART as UTC internally) — convert those digits to
          // the correct UTC instant using the event's real TZID.
          const iso = occ.toISOString().replace("Z", "");
          start = zonedWallClockToUTC(iso, dtStartTzid || DEFAULT_TZ);
        }
        const end = new Date(start.getTime() + duration);
        // Overlap with the window (see the non-recurring branch above) —
        // covers a recurring event whose duration spans past timeMax or
        // whose occurrence started just before timeMin.
        if (start > timeMax || end < timeMin) continue;
        const instanceUid = `${uid}_${start.toISOString()}`;
        events.push(makeEvent(start, end, instanceUid));
      }
    } catch (_e) {
      if (startParsed.date <= timeMax && endParsed.date >= timeMin) {
        events.push(makeEvent(startParsed.date, endParsed.date, uid));
      }
    }
  }

  return events;
}

async function fetchICalEvents(
  timeMin: Date,
  timeMax: Date,
  enabled = true,
): Promise<{ events: any[]; clusters: DedupeCluster[] }> {
  const icsFeeds = parseIcsFeeds(runtimeFeeds.ics);
  const squarespaceFeeds = parseSquarespaceFeeds(runtimeFeeds.squarespace);
  const rssFeeds = parseRssFeeds(runtimeFeeds.rss);

  // _rank decides which record survives a merge: lower wins. Feeds are ranked
  // in the order they are listed in the admin panel, so the most
  // authoritative calendar goes first; supplemental scraped sources rank
  // behind all of them. See lib/dedupe.ts.
  const allEvents: any[] = [];
  // Settled, not all-or-nothing: one dead or oversized feed is logged and
  // skipped (as the other source types already are) instead of turning the
  // whole calendar into a 500.
  const icsResults = await Promise.allSettled(icsFeeds.map(async ({ url, name, gcalId }, rank) => {
    const res = await cachedFetchText(url, { "User-Agent": "CommunityCalendar/1.0 (+https://40thward.org)" });
    if (!res.ok) throw new Error(`iCal fetch failed for ${name}: ${res.status}`);
    // gcalId is empty for non-Google feeds, which makes buildGCalLink()
    // return no link rather than a broken one.
    const found = parseICS(res.text, name, gcalId, timeMin, timeMax);
    for (const ev of found) ev._rank = rank;
    return found;
  }));
  icsResults.forEach((r, i) => {
    if (r.status === "fulfilled") allEvents.push(...r.value);
    else console.error(`[ics] ${icsFeeds[i].name} failed, skipping:`, r.reason?.message ?? r.reason);
  });
  if (icsFeeds.length > 0 && icsResults.every(r => r.status === "rejected")) {
    // Every primary calendar failed: say so rather than serving an empty page
    // that looks like "no events".
    throw new Error("Could not load any calendar feed");
  }

  // Supplemental non-ICS sources. Deliberately settled, not awaited as a
  // group: a broken third-party site must never take down the ward calendar.
  const sqspResults = await Promise.allSettled(
    squarespaceFeeds.map(src => fetchSquarespaceEvents(src, timeMin, timeMax)),
  );
  sqspResults.forEach((r, i) => {
    const src = squarespaceFeeds[i];
    if (r.status === "fulfilled") {
      console.log(`[squarespace] ${src.name}: ${r.value.length} event(s) in window`);
      for (const ev of r.value) {
        ev._rank = icsFeeds.length + i;
        allEvents.push(ev);
      }
    } else {
      console.error(`[squarespace] ${src.name} failed, skipping:`, r.reason?.message ?? r.reason);
    }
  });

  // RSS sources rank behind every ICS and Squarespace feed, so a ward or
  // Squarespace listing always wins a duplicate merge over one of these —
  // these carry the least data (no end time, no location).
  const rssResults = await Promise.allSettled(
    rssFeeds.map(src => fetchRssEvents(src, timeMin, timeMax)),
  );
  rssResults.forEach((r, i) => {
    const src = rssFeeds[i];
    if (r.status === "fulfilled") {
      console.log(`[rss] ${src.name}: ${r.value.length} event(s) in window`);
      for (const ev of r.value) {
        ev._rank = icsFeeds.length + squarespaceFeeds.length + i;
        allEvents.push(ev);
      }
    } else {
      console.error(`[rss] ${src.name} failed, skipping:`, r.reason?.message ?? r.reason);
    }
  });

  // Farmers markets: a fixed, hand-checked .ics (see lib/farmersMarket.ts)
  // rather than a feed, since DCASE publishes no exportable schedule. Runs
  // through the same parseICS() as a network feed, just with no fetch to
  // fail, so a try/catch is enough to keep it from ever affecting the rest
  // of the calendar; ranked last since nothing else lists these events.
  try {
    const fmRank = icsFeeds.length + squarespaceFeeds.length + rssFeeds.length;
    const fmEvents = parseICS(FARMERS_MARKET_ICS, FARMERS_MARKET_FEED_NAME, "", timeMin, timeMax);
    for (const ev of fmEvents) {
      ev._rank = fmRank;
      allEvents.push(ev);
    }
    console.log(`[farmers-market] ${fmEvents.length} event(s) in window`);
  } catch (e: any) {
    console.error("[farmers-market] failed to parse static schedule, skipping:", e.message);
  }

  // Overlapping service areas mean the same real-world event is often
  // published by several of these orgs, each with its own UID. See
  // lib/dedupe.ts for why this is exact-title + time/place gated rather than
  // a similarity score.
  const { events: deduped, clusters } = enabled
    ? dedupeEvents(allEvents)
    : { events: allEvents, clusters: [] as DedupeCluster[] };

  if (clusters.length > 0) {
    const dropped = clusters.reduce((n, c) => n + c.dropped.length, 0);
    console.log(`[dedupe] merged ${dropped} duplicate(s) into ${clusters.length} event(s); ${allEvents.length} → ${deduped.length}`);
  }

  deduped.sort((a, b) => {
    const as = a.start?.dateTime ?? a.start?.date ?? "";
    const bs = b.start?.dateTime ?? b.start?.date ?? "";
    return new Date(as).getTime() - new Date(bs).getTime();
  });

  return { events: deduped, clusters };
}

// ── Shape raw event ───────────────────────────────────────────────────────────
function shapeEvent(ev: any) {
  const title = ev.summary ?? "(no title)";
  const desc  = ev.description ?? "";
  const cat   = categorize(title, desc, ev.organizer?.displayName ?? "", Array.isArray(ev.sources) ? ev.sources : []);
  const startRaw = ev.start?.dateTime ?? ev.start?.date ?? "";
  const endRaw   = ev.end?.dateTime ?? ev.end?.date ?? "";
  const isAllDay = !ev.start?.dateTime;

  return {
    id: ev.id,
    title,
    start: startRaw,
    end: endRaw,
    isAllDay,
    location: ev.location ?? "",
    description: desc,
    organizer: ev.organizer?.displayName ?? ev.organizer?.email ?? "",
    status: ev.status ?? "",
    htmlLink: ev.htmlLink ?? "",
    category: cat.key,
    categoryLabel: cat.label,
    categoryIcon: cat.icon,
    categoryColor: cat.color,
    categoryGroup: cat.group,
    // Every organization that published this event, most authoritative first.
    // Present only when it was merged from more than one source.
    sources: (ev.sources as string[] | undefined) ?? undefined,
    duplicateCount: (ev.duplicateCount as number | undefined) ?? undefined,
  };
}

// ── Hono app ──────────────────────────────────────────────────────────────────
const app = new Hono()
  .use(cors({ origin: (origin) => origin ?? "*", credentials: true, exposeHeaders: ["set-auth-token"] }))
  .on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))
  .basePath("api")

  .get("/health", (c) => c.json({ status: "ok" }, 200))

  // ── Admin auth check: is the current session an allowlisted admin? ───────
  .get("/admin/whoami", async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    const email = session?.user?.email ?? null;
    const authorized = !!email && ADMIN_EMAIL_ALLOWLIST.includes(email);
    return c.json({ signedIn: !!session, email, authorized }, 200);
  })

  // ── Public: serve an uploaded category icon ──────────────────────────────
  .get("/icons/:file", (c) => {
    const file = c.req.param("file");
    // Guard against path traversal — only allow simple generated filenames.
    if (!/^[a-zA-Z0-9._-]+\.png$/.test(file)) return c.json({ error: "Not found" }, 404);
    const full = path.join(ICONS_DIR, file);
    if (!fs.existsSync(full)) return c.json({ error: "Not found" }, 404);
    const buf = fs.readFileSync(full);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  })

  // ── Admin: upload a category icon (client sends a pre-scaled PNG data URL) ──
  .post("/admin/icons", requireAdminAuth, async (c) => {
    try {
      const body = await c.req.json() as { dataUrl?: string; key?: string };
      const dataUrl = body.dataUrl ?? "";
      const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
      if (!match) return c.json({ error: "Expected a base64 PNG data URL" }, 400);

      const buf = Buffer.from(match[1], "base64");
      // Scaled client-side to 128x128 max, so anything large is suspicious.
      if (buf.length > 512 * 1024) return c.json({ error: "Icon too large" }, 400);

      // Validate the PNG signature and read dimensions straight out of the IHDR
      // chunk (bytes 16-23) so we don't need an image library on the server.
      const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIG)) {
        return c.json({ error: "Not a valid PNG" }, 400);
      }
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      if (width < 1 || height < 1 || width > 512 || height > 512) {
        return c.json({ error: `Icon must be 512x512 or smaller (got ${width}x${height})` }, 400);
      }

      const slug = (body.key ?? "icon").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32) || "icon";
      const filename = `${slug}-${Date.now()}.png`;

      fs.mkdirSync(ICONS_DIR, { recursive: true });
      const full = path.join(ICONS_DIR, filename);
      const tmp = `${full}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, full);

      return c.json({ ok: true, url: `/api/icons/${filename}` }, 200);
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  })

  // ── Public: current site settings (header/subtitle/footer link) ──────────
  .get("/settings", (c) => c.json(runtimeSettings, 200))

  // ── Public: which organizations' calendars this site pulls together ──────
  // Organizer names are already public via /api/events (ev.organizer), so
  // this adds no new exposure — it's a de-duplicated, human-readable list for
  // the About popup. Raw feed URLs (the .ics/JSON/RSS endpoints themselves)
  // stay out of it — admin-only by design (see lib/feeds.ts). What's linked
  // instead is each source's `pageUrl`: the public website page that
  // presents the calendar (which may just embed it, e.g. via an iframe),
  // not the feed data behind it. An ICS feed has no page of its own, so it's
  // only linked when one has been configured explicitly.
  .get("/sources", (c) => {
    const sources: { name: string; link: string | null }[] = [];
    for (const { name, pageUrl } of parseIcsFeeds(runtimeFeeds.ics)) {
      sources.push({ name, link: pageUrl || null });
    }
    for (const { name, pageUrl } of parseSquarespaceFeeds(runtimeFeeds.squarespace)) {
      sources.push({ name, link: pageUrl || null });
    }
    for (const { name, pageUrl, url } of parseRssFeeds(runtimeFeeds.rss)) {
      sources.push({ name, link: pageUrl || originOf(url) });
    }
    // Static, not a configurable feed — see lib/farmersMarket.ts.
    sources.push({ name: FARMERS_MARKET_FEED_NAME, link: FARMERS_MARKET_PAGE_URL });
    return c.json({ sources }, 200);
  })

  // ── Diagnostics: is Google OAuth actually configured correctly? ────────────
  // ?error=invalid_code in the browser only means "the token exchange failed",
  // so probe Google's token endpoint with a deliberately bogus code. Google
  // answers invalid_client when the id/secret pair is wrong and invalid_grant
  // when the credentials are fine and only the code was bad. Leaks nothing.
  .get("/auth-diagnostics", async (c) => {
    const clientId = (process.env.GOOGLE_CLIENT_ID ?? "").trim();
    const clientSecret = (process.env.GOOGLE_CLIENT_SECRET ?? "").trim();
    const baseUrlRaw = (process.env.WEBSITE_URL ?? process.env.RAILWAY_PUBLIC_DOMAIN ?? "").trim();
    let origin = "";
    try {
      origin = new URL(/^https?:\/\//i.test(baseUrlRaw) ? baseUrlRaw : `https://${baseUrlRaw}`).origin;
    } catch { /* reported below */ }

    const redirectUri = origin ? `${origin}/api/auth/callback/google` : null;
    const result: Record<string, unknown> = {
      websiteUrlRaw: baseUrlRaw || null,
      resolvedOrigin: origin || null,
      requestOrigin: new URL(c.req.url).origin,
      redirectUri,
      clientIdPresent: Boolean(clientId),
      clientIdSuffixOk: clientId.endsWith(".apps.googleusercontent.com"),
      clientSecretPresent: Boolean(clientSecret),
      credentialsHadWhitespace:
        process.env.GOOGLE_CLIENT_ID !== clientId || process.env.GOOGLE_CLIENT_SECRET !== clientSecret,
    };

    if (!clientId || !clientSecret || !redirectUri) {
      result.verdict = "Google credentials or WEBSITE_URL are not fully configured.";
      return c.json(result, 200);
    }

    try {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: "runable-diagnostic-not-a-real-code",
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      const body = await res.json().catch(() => ({}));
      const err = (body as any)?.error ?? null;
      result.googleStatus = res.status;
      result.googleError = err;
      result.googleErrorDescription = (body as any)?.error_description ?? null;

      const desc = String((body as any)?.error_description ?? "");
      if (err === "invalid_grant") {
        // Google validates the code before the redirect URI, so reaching this
        // point proves the id/secret pair is good but says nothing about
        // whether the redirect URI is registered.
        result.verdict = "CREDENTIALS OK — Google accepts this client id + secret pair. If login still fails, the cause is the redirect URI registration or the authorization code itself; check the Railway logs for the logged callback error.";
      } else if (err === "invalid_client" && /secret/i.test(desc)) {
        result.verdict = "BAD CLIENT SECRET — Google accepts the client id but rejects the secret. Re-copy GOOGLE_CLIENT_SECRET from the Google Cloud console into Railway.";
      } else if (err === "invalid_client") {
        result.verdict = "BAD CLIENT ID — Google can't find this OAuth client. Check GOOGLE_CLIENT_ID, and that the client still exists and is a 'Web application' client in the right project.";
      } else {
        result.verdict = `Unexpected response from Google: ${err ?? res.status} ${desc}`;
      }
      result.redirectUriRegistrationChecked = false;
      result.note = `This probe cannot verify redirect URI registration. Confirm "${redirectUri}" is listed verbatim under the OAuth client's Authorized redirect URIs.`;
    } catch (e: any) {
      result.verdict = `Could not reach Google's token endpoint: ${e.message}`;
    }

    return c.json(result, 200);
  })

  // ── Admin: replace site settings ──────────────────────────────────────────
  .put("/admin/settings", requireAdminAuth, async (c) => {
    try {
      const body = await c.req.json();
      const next: SiteSettings = {
        headerTitle: typeof body.headerTitle === "string" ? body.headerTitle : DEFAULT_SETTINGS.headerTitle,
        headerSubtitle: typeof body.headerSubtitle === "string" ? body.headerSubtitle : DEFAULT_SETTINGS.headerSubtitle,
        // Empty is meaningful for the footer fields too (it hides them), so
        // these must not fall back to defaults the way the header fields do.
        footerText: typeof body.footerText === "string" ? body.footerText : "",
        footerLinkText: typeof body.footerLinkText === "string" ? body.footerLinkText : "",
        footerLinkUrl: typeof body.footerLinkUrl === "string" ? body.footerLinkUrl : "",
        // Empty is a meaningful value here (it hides the button), so this
        // must not fall back to the default the way the header fields do.
        submitEventUrl: typeof body.submitEventUrl === "string" ? body.submitEventUrl : "",
        // Empty hides the contact line in the About popup, same reasoning.
        contactEmail: typeof body.contactEmail === "string" ? body.contactEmail : "",
      };
      saveSettings(next);
      runtimeSettings = loadSettings();
      return c.json({ ok: true, settings: runtimeSettings }, 200);
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  })

  // ── Admin: read the calendar feed sources ─────────────────────────────────
  // Admin-only, same as the WordPress plugin's settings screen. Feed URLs are
  // not part of the public /api/settings payload.
  .get("/admin/feeds", requireAdminAuth, (c) => {
    return c.json({
      feeds: runtimeFeeds,
      // Echo what the raw text actually resolves to, so the admin can see
      // that a bare Google Calendar id expanded to the URL they expect.
      resolved: {
        ics: parseIcsFeeds(runtimeFeeds.ics),
        squarespace: parseSquarespaceFeeds(runtimeFeeds.squarespace),
        rss: parseRssFeeds(runtimeFeeds.rss),
      },
    }, 200);
  })

  // ── Admin: replace the calendar feed sources ──────────────────────────────
  .put("/admin/feeds", requireAdminAuth, async (c) => {
    try {
      const body = await c.req.json();
      const next: FeedSettings = {
        ics: typeof body.ics === "string" ? body.ics : "",
        squarespace: typeof body.squarespace === "string" ? body.squarespace : "",
        rss: typeof body.rss === "string" ? body.rss : "",
      };

      // Reject typos rather than silently dropping a calendar.
      const errors = validateFeeds(next);
      if (errors.length > 0) return c.json({ error: errors.join(" ") }, 400);

      // At least one readable calendar must survive, otherwise the site would
      // save itself into a permanently empty state.
      if (
        parseIcsFeeds(next.ics).length === 0 &&
        parseSquarespaceFeeds(next.squarespace).length === 0 &&
        parseRssFeeds(next.rss).length === 0
      ) {
        return c.json({ error: "Add at least one calendar feed — saving would leave the site with no events." }, 400);
      }

      saveFeeds(next);
      runtimeFeeds = loadFeeds();
      clearFeedCache();
      return c.json({
        ok: true,
        feeds: runtimeFeeds,
        resolved: {
          ics: parseIcsFeeds(runtimeFeeds.ics),
          squarespace: parseSquarespaceFeeds(runtimeFeeds.squarespace),
          rss: parseRssFeeds(runtimeFeeds.rss),
        },
      }, 200);
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  })

  .get("/categories", (c) => {
    return c.json(
      runtimeCategories.map(({ key, label, icon, color, group, order }) => ({ key, label, icon, color, group, order })),
      200
    );
  })

  // ── Admin: get full category list including keywords ──────────────────────
  .get("/admin/categories", requireAdminAuth, (c) => {
    return c.json(
      runtimeCategories.map(({ key, label, icon, color, group, order, keywords }) => ({
        key, label, icon, color, group, order, keywords,
      })),
      200
    );
  })

  // ── Admin: replace full category list ────────────────────────────────────
  .put("/admin/categories", requireAdminAuth, async (c) => {
    try {
      const body = await c.req.json() as Omit<CategoryDef, "match">[];
      if (!Array.isArray(body)) return c.json({ error: "Expected array" }, 400);

      // Validate required fields
      for (const cat of body) {
        if (!cat.key || typeof cat.label !== "string") {
          return c.json({ error: `Invalid category: ${JSON.stringify(cat)}` }, 400);
        }
      }

      // Ensure "other" is always last
      const withoutOther = body.filter(c => c.key !== "other");
      const other = body.find(c => c.key === "other");
      const ordered = withoutOther.map((c, i) => ({ ...c, order: i }));
      if (other) ordered.push({ ...other, order: ordered.length, keywords: [] });

      saveCategories(ordered);
      runtimeCategories = loadCategories();

      return c.json({ ok: true, count: runtimeCategories.length }, 200);
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  })

  .get("/events", async (c) => {
    try {
      const qMin = c.req.query("timeMin");
      const qMax = c.req.query("timeMax");

      let timeMin: Date, timeMax: Date;
      if (qMin && qMax) {
        timeMin = new Date(qMin);
        timeMax = new Date(qMax);
      } else {
        const now = new Date();
        timeMin = new Date(now);
        timeMin.setHours(0, 0, 0, 0);
        timeMax = new Date(timeMin);
        timeMax.setDate(timeMax.getDate() + 31);
      }

      // Escape hatches for verifying the de-duplication against live data:
      //   ?dedupe=off   return every record, nothing merged
      //   ?debug=dupes  include the merge report in the response
      const dedupeOn = c.req.query("dedupe") !== "off";
      const wantReport = c.req.query("debug") === "dupes";

      let raw: any[] = [];
      let clusters: DedupeCluster[] = [];
      try {
        const result = await fetchICalEvents(timeMin, timeMax, dedupeOn);
        raw = result.events;
        clusters = result.clusters;
      } catch (e: any) {
        console.error("iCal fetch failed:", e.message);
        return c.json({ error: e.message }, 500);
      }

      const events = raw.map(shapeEvent);
      const grouped: Record<string, typeof events> = {};
      for (const ev of events) {
        if (!grouped[ev.category]) grouped[ev.category] = [];
        grouped[ev.category].push(ev);
      }

      const body: Record<string, unknown> = {
        events,
        grouped,
        fetchedAt: new Date().toISOString(),
        duplicatesMerged: clusters.reduce((n, cl) => n + cl.dropped.length, 0),
      };
      if (wantReport) body.duplicateReport = clusters;

      // Let browsers and any CDN reuse the answer briefly; the feeds
      // themselves are cached server-side for five minutes anyway.
      c.header("Cache-Control", "public, max-age=60");
      return c.json(body, 200);
    } catch (e: any) {
      console.error("/api/events error:", e);
      return c.json({ error: e.message ?? "Unknown error" }, 500);
    }
  });

export type AppType = typeof app;
export default app;
