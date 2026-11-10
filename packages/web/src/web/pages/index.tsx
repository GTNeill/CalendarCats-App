import { useState, useRef, useEffect } from "react";
import {
  RefreshCw, LayoutGrid, CalendarDays, AlertCircle,
  ChevronLeft, ChevronRight, Sun, Moon, ZoomIn, ZoomOut, Search, X, ExternalLink, Info
} from "lucide-react";
import { useEvents } from "../hooks/useEvents";
import { useQueryClient } from "@tanstack/react-query";
import CategoryCards from "../components/CategoryCards";
import CalendarGrid from "../components/CalendarGrid";
import SkeletonCards from "../components/SkeletonCards";
import SkeletonTimeline from "../components/SkeletonTimeline";
import SearchResults from "../components/SearchResults";
import AboutModal from "../components/AboutModal";
import { timeSince, getRange, getRollingRange, fmtRangeLabel, toISO, type RangeUnit } from "../lib/calendarUtils";
import { useTheme } from "../lib/theme";
import { useIsMobile } from "../hooks/useIsMobile";
import { useSiteSettings } from "../hooks/useSiteSettings";
import { useCategoryFilter } from "../hooks/useCategoryFilter";

type Tab = "cards" | "timeline";

const ZOOM_MIN = 75;
const ZOOM_MAX = 150;
const ZOOM_STEP = 5;
const ZOOM_DEFAULT = 100;

/* ─── Vertical zoom slider — scales content text/layout via CSS zoom ─── */
function ZoomSlider({
  zoom,
  onChange,
  top,
  theme,
}: {
  zoom: number;
  onChange: (z: number) => void;
  top: number;
  theme: ReturnType<typeof useTheme>["theme"];
}) {
  return (
    <div
      role="group"
      aria-label="Content zoom"
      title={`Content zoom: ${zoom}%`}
      style={{
        position: "fixed",
        top: top + 16,
        right: 24,
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "8px",
        padding: "12px 8px",
        borderRadius: 12,
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        boxShadow: theme.mode === "dark" ? "0 4px 14px rgba(0,0,0,0.4)" : "0 4px 14px rgba(0,0,0,0.08)",
      }}
    >
      <button
        onClick={() => onChange(Math.min(ZOOM_MAX, zoom + ZOOM_STEP))}
        title="Increase text size"
        aria-label="Increase text size"
        disabled={zoom >= ZOOM_MAX}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 26, height: 26, borderRadius: 6, border: "none",
          background: "transparent", color: theme.textMuted,
          cursor: zoom >= ZOOM_MAX ? "not-allowed" : "pointer",
          opacity: zoom >= ZOOM_MAX ? 0.35 : 1,
        }}
      >
        <ZoomIn size={15} />
      </button>

      <input
        type="range"
        min={ZOOM_MIN}
        max={ZOOM_MAX}
        step={ZOOM_STEP}
        value={zoom}
        onChange={e => onChange(Number(e.target.value))}
        title={`Content zoom: ${zoom}%`}
        aria-label="Content text zoom level"
        // Vertical range input: -webkit-appearance covers Chrome/Safari/Edge,
        // orient="vertical" (via prop spread) covers Firefox.
        {...({ orient: "vertical" } as any)}
        style={{
          WebkitAppearance: "slider-vertical" as any,
          width: 20,
          height: 110,
          accentColor: theme.primary,
          cursor: "pointer",
          background: "transparent",
        }}
      />

      <button
        onClick={() => onChange(Math.max(ZOOM_MIN, zoom - ZOOM_STEP))}
        title="Decrease text size"
        aria-label="Decrease text size"
        disabled={zoom <= ZOOM_MIN}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 26, height: 26, borderRadius: 6, border: "none",
          background: "transparent", color: theme.textMuted,
          cursor: zoom <= ZOOM_MIN ? "not-allowed" : "pointer",
          opacity: zoom <= ZOOM_MIN ? 0.35 : 1,
        }}
      >
        <ZoomOut size={15} />
      </button>

      <button
        type="button"
        onClick={() => onChange(ZOOM_DEFAULT)}
        title="Reset zoom to 100%"
        aria-label={`Reset zoom to 100 percent. Current zoom ${zoom} percent`}
        style={{
          fontSize: "0.62rem",
          fontWeight: 700,
          color: theme.textMuted,
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          userSelect: "none",
          letterSpacing: "0.02em",
        }}
      >
        {zoom}%
      </button>
    </div>
  );
}

export default function Index() {
  const { theme, toggle } = useTheme();
  const isMobile = useIsMobile();
  const isEmbed = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("embed") === "1";
  const { data: siteSettings } = useSiteSettings();
  const headerTitle = siteSettings?.headerTitle ?? "Community Calendar";
  const headerSubtitle = siteSettings?.headerSubtitle ?? "Chicago Community Events Calendar";
  const footerText = siteSettings?.footerText ?? "";
  const footerLinkText = siteSettings?.footerLinkText ?? "";
  const footerLinkUrl = siteSettings?.footerLinkUrl ?? "";
  // Blank hides the Submit Your Event button entirely. Undefined means the
  // settings request is still in flight, so stay hidden until it resolves
  // rather than flashing a button that may be turned off.
  const submitEventUrl = (siteSettings?.submitEventUrl ?? "").trim();
  const [tab, setTab] = useState<Tab>("cards");
  const [unit, setUnit] = useState<RangeUnit>("month");
  const [offset, setOffset] = useState(0);
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  const [search, setSearch] = useState("");
  // Shared between Cards and Calendar; optionally remembered in a cookie as
  // the visitor's default view when they check "Remember my filter" — see
  // useCategoryFilter.
  const { selected: selectedCats, setSelected: setSelectedCats, remember: rememberFilter, setRemember: setRememberFilter } = useCategoryFilter();
  const [aboutOpen, setAboutOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(140);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => setHeaderHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // When embedded in an iframe (e.g. the CalendarCats WordPress plugin),
  // report document height to the parent window so it can auto-resize the iframe.
  useEffect(() => {
    if (!isEmbed || typeof window === "undefined") return;
    const postHeight = () => {
      const height = document.documentElement.scrollHeight;
      window.parent?.postMessage({ type: "wpcalendarcats:resize", height }, "*");
    };
    postHeight();
    const ro = new ResizeObserver(postHeight);
    ro.observe(document.documentElement);
    window.addEventListener("load", postHeight);
    return () => {
      ro.disconnect();
      window.removeEventListener("load", postHeight);
    };
  }, [isEmbed]);

  // Cards use rolling range (today → +week/month); Calendar grid uses calendar-aligned range
  const cardRange = getRollingRange(unit, offset);
  const gridRange = getRange(unit, offset);
  const { start, end } = tab === "cards" ? cardRange : gridRange;
  const timeMin = toISO(start);
  const timeMax = toISO(end);
  const rangeLabel = fmtRangeLabel(start, end);

  const { data, isLoading, isError, error, isFetching, dataUpdatedAt } = useEvents({ timeMin, timeMax });
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["calendar-events"] });

  // Button styles matching the Community Calendar aesthetic
  const btnBase: React.CSSProperties = {
    fontFamily: theme.fontBody,
    borderColor: theme.border,
    color: theme.textPrimary,
    transition: "border-color 0.15s, color 0.15s, background 0.15s",
  };
  const onEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.borderColor = theme.primary;
    e.currentTarget.style.color = theme.primary;
  };
  const onLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.borderColor = theme.border;
    e.currentTarget.style.color = theme.textPrimary;
  };

  const Divider = () => (
    // Hidden on mobile — with flex-wrap active, a vertical divider between
    // wrapped groups ends up floating on its own line, which looks broken.
    isMobile ? null : (
      <div className="w-px self-stretch my-3 flex-shrink-0" style={{ background: theme.border }} />
    )
  );

  return (
    <div
      className="min-h-screen"
      style={{
        background: theme.bg,
        fontFamily: theme.fontBody,
        // Drives the global :focus-visible ring in styles.css so the
        // indicator stays high-contrast in both themes (WCAG 2.4.7).
        ["--a11y-focus" as any]: theme.focusRing,
      }}
    >
      {/* WCAG 2.4.1 Bypass Blocks — lets keyboard users jump the toolbar,
          which is ~10 controls deep before the first event. */}
      <a
        href="#main-content"
        className="skip-link"
        style={{ background: theme.primary, color: "#ffffff" }}
      >
        Skip to events
      </a>

      {/* ── Top accent bar ── */}
      {!isEmbed && <div style={{ height: 4, background: theme.primary }} />}

      {/* ── Header ── */}
      <header
        ref={headerRef}
        className={isEmbed ? "" : "sticky top-0 z-10 border-b"}
        style={{
          background: theme.bgHeader,
          borderColor: theme.border,
          backdropFilter: isEmbed ? undefined : "blur(8px)",
        }}
      >
        <div style={{ maxWidth: 1152, margin: "0 auto", padding: isMobile ? "0 16px" : "0 48px" }}>

          {/* Row 1: Logo area + range label — excluded from embed mode.
              The date matches the title's size and sits beside it,
              right-justified, on desktop. On mobile the combined width of
              a full-size title + full-size date doesn't fit one line, so
              the date drops to its own line below instead of truncating
              the title. */}
          {!isEmbed && (
            <div className="pb-2" style={{ paddingTop: isMobile ? 24 : 40 }}>
              <div
                className={isMobile ? "" : "flex items-baseline justify-between"}
                style={isMobile ? undefined : { gap: 16, flexWrap: "nowrap" }}
              >
                <h1
                  className="leading-none"
                  style={{
                    fontFamily: theme.fontDisplay,
                    fontSize: isMobile ? "1.3rem" : "1.85rem",
                    fontWeight: 700,
                    color: theme.textPrimary,
                    letterSpacing: "0.02em",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    minWidth: 0,
                  }}
                >
                  {headerTitle}
                </h1>
                <p
                  className="leading-none"
                  style={{
                    fontFamily: theme.fontBody,
                    // Same size as the title (h1 above), per request.
                    fontSize: isMobile ? "1.3rem" : "1.85rem",
                    fontWeight: 600,
                    color: theme.textPrimary,
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                    textAlign: isMobile ? "left" : "right",
                    marginTop: isMobile ? 4 : 0,
                  }}
                >
                  {rangeLabel}
                </p>
              </div>
              <div className="flex items-baseline justify-between mt-0.5" style={{ gap: 16 }}>
                <p
                  style={{
                    fontFamily: theme.fontBody,
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    color: theme.textMuted,
                    letterSpacing: "0.04em",
                  }}
                >
                  {headerSubtitle}
                </p>
                {dataUpdatedAt > 0 && (
                  // role="status" announces background refreshes to screen readers (WCAG 4.1.3).
                  // The opacity that used to sit here dropped this text to 2.01:1 — removed for 1.4.3.
                  <span className="text-xs" role="status" aria-live="polite" style={{ color: theme.textMuted, flexShrink: 0 }}>
                    Updated {timeSince(new Date(dataUpdatedAt).toISOString())}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Embed mode has no title row to anchor the range label to, so it
              keeps its own line here instead. Sized at double the original
              text-sm (0.875rem) baseline, per request — the embed's date
              size is independent of the main site header above. */}
          {isEmbed && (
            <div className="pb-2" style={{ paddingTop: 16 }}>
              <p style={{ color: theme.textPrimary, fontFamily: theme.fontBody, fontSize: "1.75rem", fontWeight: 600 }}>
                {rangeLabel}
              </p>
              {dataUpdatedAt > 0 && (
                <span className="text-xs" role="status" aria-live="polite" style={{ color: theme.textMuted }}>
                  Updated {timeSince(new Date(dataUpdatedAt).toISOString())}
                </span>
              )}
            </div>
          )}

          {/* Row 3: Controls — wraps onto multiple lines instead of overflowing/scrolling */}
          <div className="flex items-center flex-wrap pb-3" style={{ gap: "10px", rowGap: "8px" }}>

            {/* ── Today / Week / Month toggle ── */}
            <div
              className="flex rounded overflow-hidden border"
              style={{ borderColor: theme.border }}
            >
              {(["day", "week", "month"] as RangeUnit[]).map(u => (
                <button
                  key={u}
                  onClick={() => { setUnit(u); setOffset(0); }}
                  aria-pressed={unit === u}
                  title={
                    u === "day" ? "Show only today's events" :
                    u === "week" ? "Show one week at a time" : "Show one month at a time"
                  }
                  style={{
                    fontFamily: theme.fontBody,
                    padding: "9px 20px",
                    fontSize: "0.8rem",
                    fontWeight: 700,
                    textTransform: "none",
                    letterSpacing: "0.08em",
                    background: unit === u ? theme.primary : "transparent",
                    color: unit === u ? "#ffffff" : theme.textPrimary,
                    borderRight: u !== "month" ? `1px solid ${theme.border}` : undefined,
                    transition: "background 0.15s, color 0.15s",
                    cursor: "pointer",
                    border: "none",
                  }}
                >
                  {u === "day" ? "Today" : u.charAt(0).toUpperCase() + u.slice(1)}
                </button>
              ))}
            </div>

            <Divider />

            {/* ── Back / Forward arrows ── */}
            <div className="flex items-center" style={{ gap: "6px" }}>
              <button
                onClick={() => setOffset(o => o - 1)}
                className="flex items-center justify-center rounded border"
                style={{ ...btnBase, width: 40, height: 40 }}
                onMouseEnter={onEnter} onMouseLeave={onLeave}
                title={unit === "day" ? "Previous day" : unit === "week" ? "Previous week" : "Previous month"}
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => setOffset(0)}
                className="rounded border font-bold text-xs"
                style={{
                  ...btnBase,
                  padding: "9px 18px",
                  textTransform: "none",
                  letterSpacing: "0.08em",
                  fontFamily: theme.fontBody,
                  fontSize: "0.8rem",
                }}
                onMouseEnter={onEnter} onMouseLeave={onLeave}
                title={unit === "day" ? "Jump back to today" : "Jump back to the current period"}
              >
                Today
              </button>
              <button
                onClick={() => setOffset(o => o + 1)}
                className="flex items-center justify-center rounded border"
                style={{ ...btnBase, width: 40, height: 40 }}
                onMouseEnter={onEnter} onMouseLeave={onLeave}
                title={unit === "day" ? "Next day" : unit === "week" ? "Next week" : "Next month"}
              >
                <ChevronRight size={16} />
              </button>
            </div>

            <Divider />

            {/* ── Cards / Calendar tabs ── */}
            <div
              className="flex rounded overflow-hidden border"
              style={{ borderColor: theme.border }}
            >
              {([
                { id: "cards",    icon: <LayoutGrid size={14} />,  label: "Cards",    title: "Card view — events grouped by category" },
                { id: "timeline", icon: <CalendarDays size={14} />, label: "Calendar", title: "Calendar/timeline view" },
              ] as const).map(({ id, icon, label, title }) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  aria-pressed={tab === id}
                  title={title}
                  className="flex items-center"
                  style={{
                    gap: "7px",
                    fontFamily: theme.fontBody,
                    padding: "9px 20px",
                    fontSize: "0.8rem",
                    fontWeight: 700,
                    textTransform: "none",
                    letterSpacing: "0.08em",
                    background: tab === id ? theme.primary : "transparent",
                    color: tab === id ? "#ffffff" : theme.textPrimary,
                    borderRight: id === "cards" ? `1px solid ${theme.border}` : undefined,
                    transition: "background 0.15s, color 0.15s",
                    cursor: "pointer",
                    border: "none",
                  }}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>

            <Divider />

            {/* ── Refresh ── */}
            <button
              onClick={refresh}
              disabled={isFetching}
              title={isFetching ? "Loading…" : "Refresh"}
              className="flex items-center justify-center rounded border disabled:opacity-40"
              style={{ ...btnBase, width: 40, height: 40 }}
              onMouseEnter={e => { if (!isFetching) onEnter(e); }}
              onMouseLeave={onLeave}
            >
              <RefreshCw size={15} className={isFetching ? "animate-spin" : ""} />
            </button>

            <Divider />

            {/* ── Theme toggle ── */}
            <button
              onClick={toggle}
              className="flex items-center justify-center rounded border"
              style={{ ...btnBase, width: 40, height: 40 }}
              onMouseEnter={onEnter} onMouseLeave={onLeave}
              title={theme.mode === "dark" ? "Light mode" : "Dark mode"}
            >
              {theme.mode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            <Divider />

            {/* ── About — what this site does and which calendars feed it ── */}
            <button
              onClick={() => setAboutOpen(true)}
              className="flex items-center justify-center rounded border"
              style={{ ...btnBase, width: 40, height: 40 }}
              onMouseEnter={onEnter} onMouseLeave={onLeave}
              title="About this calendar"
              aria-haspopup="dialog"
            >
              <Info size={16} />
            </button>

            {/* ── Submit Your Event — pinned to the right margin of the control bar.
                URL is editable from /admincat; blank hides the button. ── */}
            {submitEventUrl && (
            <a
              href={submitEventUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center rounded font-bold"
              style={{
                marginLeft: "auto",
                gap: "8px",
                fontFamily: theme.fontBody,
                padding: "9px 18px",
                fontSize: "0.85rem",
                letterSpacing: "0.02em",
                background: theme.primary,
                color: "#ffffff",
                textDecoration: "none",
                transition: "background 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = "0.85"; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
              title="Submit your event to the Community Calendar"
            >
              Submit Your Event
              <ExternalLink size={14} />
            </a>
            )}

          </div>{/* end row 3 controls */}
        </div>
      </header>

      {/* ── Zoom slider — floats over the content page, not the header ── */}
      {!isMobile && <ZoomSlider zoom={zoom} onChange={setZoom} top={headerHeight} theme={theme} />}

      {/* ── Main ── */}
      <main id="main-content" tabIndex={-1} style={{ maxWidth: 1152, margin: "0 auto", padding: isMobile ? "20px 16px" : "40px 48px", zoom: `${isMobile ? 100 : zoom}%` as any }}>

        {/* Error */}
        {isError && (
          <div
            className="flex items-center gap-3 p-4 rounded mb-8 border"
            style={{
              background: theme.mode === "dark" ? "#1a0808" : "#fff5f5",
              borderColor: "#CF2C28",
            }}
          >
            <AlertCircle size={16} style={{ color: "#CF2C28", flexShrink: 0 }} />
            <div>
              <p className="text-sm font-semibold" style={{ color: "#CF2C28", fontFamily: theme.fontBody }}>
                Failed to load events
              </p>
              <p className="text-xs mt-0.5" style={{ color: theme.textMuted }}>{error?.message}</p>
            </div>
            <button
              onClick={refresh}
              className="ml-auto text-xs px-4 py-2 rounded border font-semibold"
              style={{
                borderColor: "#CF2C28",
                color: "#CF2C28",
                fontFamily: theme.fontBody,
                letterSpacing: "0.08em",
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Search — filters events already loaded for the current view */}
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              borderRadius: 10,
              border: `1.5px solid ${search ? theme.primary : theme.border}`,
              background: theme.surface,
              transition: "border-color 0.15s",
              maxWidth: 420,
            }}
          >
            <Search size={16} style={{ color: theme.textMuted, flexShrink: 0 }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search events in this view…"
              aria-label="Search events in this view"
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                background: "transparent",
                color: theme.textPrimary,
                fontFamily: theme.fontBody,
                fontSize: "0.85rem",
                minWidth: 0,
              }}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                title="Clear search"
                aria-label="Clear search"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 22, height: 22, borderRadius: 6, border: "none",
                  background: "transparent", color: theme.textMuted, cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div key={`${tab}-${unit}-${offset}`}>
          {search.trim() ? (
            data ? <SearchResults query={search} events={data.events} /> : null
          ) : tab === "cards" ? (
            isLoading ? <SkeletonCards /> : data ? (
              <CategoryCards grouped={data.grouped} selectedCats={selectedCats} onChangeSelectedCats={setSelectedCats} rememberFilter={rememberFilter} onChangeRememberFilter={setRememberFilter} />
            ) : null
          ) : (
            isLoading ? <SkeletonTimeline /> : data ? (
              <CalendarGrid events={data.events} start={start} end={end} unit={unit} selectedCats={selectedCats} onChangeSelectedCats={setSelectedCats} rememberFilter={rememberFilter} onChangeRememberFilter={setRememberFilter} />
            ) : null
          )}
        </div>

      </main>

      {/* ── Footer — branding, excluded from embed mode ── */}
      {!isEmbed && (
        <footer
          className="mt-12 py-8"
          style={{
            background: theme.mode === "dark" ? "#051820" : "#0b3e4a",
            borderTop: `4px solid ${theme.primary}`,
          }}
        >
          <div style={{ maxWidth: 1152, margin: "0 auto", padding: isMobile ? "0 16px" : "0 48px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
            {footerText && (
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.55)", fontFamily: theme.fontBody }}>
                {footerText}
              </p>
            )}
            {footerLinkUrl && (
              <a
                href={footerLinkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-semibold"
                // marginLeft:auto keeps the link right-aligned even when the
                // footer text is blank and it is the only child of this
                // space-between row.
                style={{ color: "#fffbf4", fontFamily: theme.fontBody, textDecoration: "none", marginLeft: "auto" }}
              >
                {footerLinkText || footerLinkUrl}
              </a>
            )}
          </div>
        </footer>
      )}

      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}

    </div>
  );
}
