import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { CalEvent } from "../lib/calendarUtils";
import {
  fmtDayNum, fmtMonthShort, fmtWeekday, fmtTime, fmtDuration, isToday, parseLocalDate, googleCalendarAddUrl,
  isMultiDay, eventLastDay, eventOccursOnDay,
} from "../lib/calendarUtils";
import { MapPin, Clock, ExternalLink, User, Calendar, AlarmClock, X, CalendarPlus } from "lucide-react";
import { useTheme } from "../lib/theme";
import { readableOn, readableOnTint, onSolid } from "../lib/a11y";
import { useIsMobile } from "../hooks/useIsMobile";
import { useCategories, buildCategoryGroups } from "../hooks/useCategories";
import CategoryIcon from "./CategoryIcon";
import FilterTip from "./FilterTip";

interface Props {
  grouped: Record<string, CalEvent[]>;
  /** Lifted to the page so Cards and Calendar share one selection — see useCategoryFilter. */
  selectedCats: Set<string>;
  onChangeSelectedCats: (next: Set<string>) => void;
  /** Whether the visitor has opted in to remembering this filter across visits. */
  rememberFilter: boolean;
  onChangeRememberFilter: (next: boolean) => void;
}

/* ─────────────────────────────────────────────
   Google Calendar-style popup
───────────────────────────────────────────── */
function EventPopup({
  ev,
  categoryColor,
  rowRef,
  isMobile,
  onClose,
  onMouseEnter,
  onMouseLeave,
}: {
  ev: CalEvent;
  categoryColor: string;
  rowRef: React.RefObject<HTMLDivElement | null>;
  isMobile?: boolean;
  onClose?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const { theme } = useTheme();
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!rowRef.current || !popupRef.current) return;
    const row = rowRef.current.getBoundingClientRect();
    const popup = popupRef.current.getBoundingClientRect();
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    const GAP = 12;

    if (isMobile) {
      // Mobile: horizontally centered (clamped), positioned below the row
      // (or above if there isn't room below) — left/right placement doesn't
      // work when the row is nearly as wide as the viewport itself.
      const left = Math.max(8, Math.min((viewW - popup.width) / 2, viewW - popup.width - 8));
      let top = row.bottom + GAP;
      if (top + popup.height > viewH - 8) top = row.top - popup.height - GAP;
      top = Math.max(8, Math.min(top, viewH - popup.height - 8));
      setPos({ top, left });
      return;
    }

    // Prefer right; fall back to left
    let left = row.right + GAP;
    if (left + popup.width > viewW - 8) left = row.left - popup.width - GAP;

    // Vertically center on the row, clamp to viewport
    let top = row.top + row.height / 2 - popup.height / 2;
    top = Math.max(8, Math.min(top, viewH - popup.height - 8));

    setPos({ top, left });
  }, [rowRef, isMobile]);

  const dur = fmtDuration(ev.start, ev.end, ev.isAllDay);
  // Some sources (events RSS) publish a start with no end. Render those
  // start-only rather than leaving a dangling en-dash.
  const timeStr = ev.isAllDay
    ? "All day"
    : ev.end
      ? `${fmtTime(ev.start, false)} – ${fmtTime(ev.end, false)}`
      : fmtTime(ev.start, false);
  const multiDay = isMultiDay(ev);
  const lastDay = eventLastDay(ev);
  const dateLine = multiDay
    ? `${fmtMonthShort(ev.start)} ${fmtDayNum(ev.start)} – ${lastDay.toLocaleString("en-US", { month: "short" })} ${lastDay.getDate()}`
    : `${fmtWeekday(ev.start)}, ${fmtMonthShort(ev.start)} ${fmtDayNum(ev.start)}`;

  const titleId = `event-popup-title-${ev.id}`;

  return (
    <div
      ref={popupRef}
      // WCAG 4.1.2 — the popup is a real dialog: it needs a role and an
      // accessible name so assistive tech announces it when focus moves in.
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "fixed",
        zIndex: 9999,
        width: isMobile ? "calc(100vw - 32px)" : 320,
        maxWidth: 320,
        top: pos ? pos.top : -9999,
        left: pos ? pos.left : -9999,
        background: theme.popupBg,
        border: `1.5px solid ${theme.popupBorder}`,
        borderRadius: 14,
        boxShadow: theme.mode === "dark"
          ? "0 0 0 1px #000, 0 12px 48px rgba(0,0,0,0.85), 0 2px 10px rgba(0,0,0,0.6)"
          : "0 0 0 1px rgba(0,0,0,0.08), 0 12px 48px rgba(0,0,0,0.22), 0 2px 10px rgba(0,0,0,0.12)",
        // Interactive on both mobile and desktop now, so the "Open in
        // Google Calendar" / "Add to Calendar" links are clickable.
        pointerEvents: "auto",
        overflow: "hidden",
      }}
    >
      {/* Colour bar — mimics GCal's left accent bar at top; on mobile doubles as a close button */}
      <div style={{ height: 6, background: categoryColor }} />
      {isMobile && (
        <button
          onClick={onClose}
          aria-label="Close"
          title="Close"
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            width: 26,
            height: 26,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
            border: "none",
            background: theme.mode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
            color: theme.textMuted,
            cursor: "pointer",
          }}
        >
          <X size={14} />
        </button>
      )}

      {/* Header */}
      <div style={{ padding: "14px 16px 10px" }}>
        <div
          style={{
            fontSize: "0.75rem",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: readableOn(categoryColor, theme.popupBg),
            marginBottom: 4,
          }}
        >
          <CategoryIcon icon={ev.categoryIcon} size={12} /> {ev.categoryLabel}
        </div>
        <div
          id={titleId}
          style={{
            fontSize: "1rem",
            fontWeight: 700,
            lineHeight: 1.3,
            color: theme.textPrimary,
          }}
        >
          {ev.title}
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: theme.border, margin: "0 16px" }} />

      {/* Body */}
      <div style={{ padding: "12px 16px 14px", display: "flex", flexDirection: "column", gap: 10 }}>

        {/* Date + time + duration */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <Clock size={14} style={{ color: categoryColor, flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontSize: "0.875rem", fontWeight: 600, color: theme.textPrimary }}>
              {dateLine}
            </div>
            <div style={{ fontSize: "0.8rem", color: theme.textMuted, marginTop: 1 }}>
              {timeStr}
              {dur && (
                <span
                  style={{
                    marginLeft: 8,
                    padding: "1px 7px",
                    borderRadius: 99,
                    background: `${categoryColor}22`,
                    color: readableOnTint(categoryColor, "22", theme.popupBg),
                    fontSize: "0.75rem",
                    fontWeight: 700,
                  }}
                >
                  {dur}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Location */}
        {ev.location && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <MapPin size={14} style={{ color: categoryColor, flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: "0.825rem", color: theme.textMuted, lineHeight: 1.4 }}>
              {ev.location}
            </div>
          </div>
        )}

        {/* Description */}
        {ev.description && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <AlarmClock size={14} style={{ color: categoryColor, flexShrink: 0, marginTop: 2 }} />
            <div
              style={{
                fontSize: "0.8rem",
                color: theme.textMuted,
                lineHeight: 1.5,
                maxHeight: 72,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
              }}
              // strip HTML tags from description
              dangerouslySetInnerHTML={{ __html: ev.description.replace(/<[^>]*>/g, " ").trim() }}
            />
          </div>
        )}

        {/* Organizer */}
        {ev.organizer && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <User size={14} style={{ color: categoryColor, flexShrink: 0 }} />
            <div style={{ fontSize: "0.8rem", color: theme.textMuted }}>{ev.organizer}</div>
          </div>
        )}

        {/* Calendar label */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Calendar size={14} style={{ color: categoryColor, flexShrink: 0 }} />
          <div style={{ fontSize: "0.8rem", color: theme.textMuted }}>{ev.categoryLabel}</div>
        </div>

        {/* Links — real clickable anchors now that the popup is interactive */}
        <div style={{ height: 1, background: theme.border }} />
        {ev.htmlLink && (
          <a
            href={ev.htmlLink}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}
          >
            <ExternalLink size={13} style={{ color: categoryColor }} />
            <span style={{ fontSize: "0.8rem", fontWeight: 600, color: readableOn(categoryColor, theme.popupBg) }}>
              Open in Google Calendar
            </span>
          </a>
        )}
        <a
          href={googleCalendarAddUrl(ev)}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}
        >
          <CalendarPlus size={13} style={{ color: categoryColor }} />
          <span style={{ fontSize: "0.8rem", fontWeight: 600, color: readableOn(categoryColor, theme.popupBg) }}>
            Add to my calendar
          </span>
        </a>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Event Row
───────────────────────────────────────────── */
function EventRow({ ev, categoryColor }: { ev: CalEvent; categoryColor: string }) {
  const { theme } = useTheme();
  const isMobile = useIsMobile();
  // Ongoing multi-day events should still read as "Today" on every day they
  // span, not just their start day.
  const today = eventOccursOnDay(ev, new Date());
  const [hovered, setHovered] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const dur = fmtDuration(ev.start, ev.end, ev.isAllDay);
  const multiDay = isMultiDay(ev);
  const lastDay = eventLastDay(ev);

  // Delay popup by 300ms to avoid flicker on quick mouse-overs
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Hide is also delayed (and cancelable) so the mouse can travel from the
  // row across the small gap into the popup itself — e.g. to click "Open in
  // Google Calendar" — without the popup disappearing first.
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  }, []);
  const scheduleHide = useCallback(() => {
    cancelHide();
    hideTimerRef.current = setTimeout(() => setHovered(false), 250);
  }, [cancelHide]);

  const handleEnter = useCallback(() => {
    if (isMobile) return; // no hover on touch devices
    cancelHide();
    timerRef.current = setTimeout(() => setHovered(true), 300);
  }, [isMobile, cancelHide]);
  const handleLeave = useCallback(() => {
    if (isMobile) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    scheduleHide();
  }, [isMobile, scheduleHide]);

  // On mobile, tapping the row shows the detail popup instead of navigating
  // straight to Google Calendar (which would otherwise open off-screen/
  // unexpectedly and skip the preview entirely). Tapping outside closes it.
  // WCAG 2.1.2 — Escape must dismiss the popup wherever focus happens to be
  // (it can be opened by hover, so focus may still be elsewhere on the page).
  useEffect(() => {
    if (!hovered) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setHovered(false);
        rowRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hovered]);

  useEffect(() => {
    if (!isMobile || !hovered) return;
    const handleOutside = (e: MouseEvent) => {
      if (rowRef.current && !rowRef.current.contains(e.target as Node)) {
        setHovered(false);
      }
    };
    document.addEventListener("click", handleOutside, true);
    return () => document.removeEventListener("click", handleOutside, true);
  }, [isMobile, hovered]);

  const activate = useCallback(() => {
    if (isMobile) {
      setHovered(v => !v);
      return;
    }
    if (ev.htmlLink) window.open(ev.htmlLink, "_blank", "noopener,noreferrer");
  }, [isMobile, ev.htmlLink]);

  const handleRowClick = (e: React.MouseEvent) => {
    e.preventDefault();
    activate();
  };

  // WCAG 2.1.1 — the row is the single interactive element for the event, so
  // it must be reachable and operable from the keyboard. Enter/Space activate
  // it; Escape dismisses the detail popup without moving focus.
  const handleRowKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate();
      return;
    }
    if (e.key === "Escape" && hovered) {
      e.stopPropagation();
      setHovered(false);
    }
  };

  return (
    <>
      <div
        ref={rowRef}
        role="button"
        tabIndex={0}
        aria-expanded={hovered}
        aria-label={
          multiDay
            ? `${ev.title}, ${fmtMonthShort(ev.start)} ${fmtDayNum(ev.start)} through ${lastDay.toLocaleString("en-US", { month: "short" })} ${lastDay.getDate()}`
            : `${ev.title}, ${fmtWeekday(ev.start)} ${fmtMonthShort(ev.start)} ${fmtDayNum(ev.start)}, ${fmtTime(ev.start, ev.isAllDay)}`
        }
        className="flex gap-4"
        style={{
          padding: "10px 14px",
          margin: "6px 8px",
          borderRadius: 10,
          // Card-like background for each event
          background: hovered
            ? `${categoryColor}18`
            : theme.mode === "dark" ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
          border: `1px solid ${hovered ? categoryColor + "55" : theme.eventBorder}`,
          // Left accent bar via box-shadow so it doesn't shift layout
          boxShadow: hovered ? `inset 3px 0 0 ${categoryColor}` : "none",
          transition: "background 0.18s, border-color 0.18s, box-shadow 0.18s",
          cursor: "pointer",
        }}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onClick={handleRowClick}
        onKeyDown={handleRowKeyDown}
      >
        {/* Date column */}
        <div
          className="flex-shrink-0 text-center"
          style={{
            minWidth: 52,
            padding: "6px 8px",
            borderRadius: 8,
            background: hovered ? `${categoryColor}28` : `${categoryColor}14`,
            border: `1px solid ${categoryColor}44`,
            transition: "background 0.18s",
          }}
        >
          <div style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, color: readableOnTint(categoryColor, "14", theme.surface) }}>
            {fmtWeekday(ev.start)}
          </div>
          <div style={{ fontSize: "1.4rem", fontWeight: 800, lineHeight: 1.1, color: theme.textPrimary }}>
            {fmtDayNum(ev.start)}
          </div>
          {/* opacity removed: it stacked on an already-tinted colour and pushed
              this 10px label under 3:1 (WCAG 1.4.3). */}
          <div style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, color: readableOnTint(categoryColor, "14", theme.surface) }}>
            {fmtMonthShort(ev.start)}
          </div>
          {multiDay && (
            <div style={{ fontSize: "0.75rem", fontWeight: 700, color: readableOnTint(categoryColor, "14", theme.surface), marginTop: 2, whiteSpace: "nowrap" }}>
              → {lastDay.toLocaleString("en-US", { month: "short" })} {lastDay.getDate()}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1" style={{ paddingTop: 3 }}>
          {/* Title row */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {/* The row itself is the interactive control (role="button"), so the
                title is plain text — nesting a link inside a button is invalid
                and produces two tab stops for one action (WCAG 4.1.2). The real
                "Open in Google Calendar" anchor lives in the detail popup. */}
            <h3
              style={{
                fontSize: "0.9rem",
                fontWeight: 700,
                margin: 0,
                color: hovered ? readableOnTint(categoryColor, "18", theme.surface) : theme.textPrimary,
                transition: "color 0.15s",
                lineHeight: 1.3,
              }}
            >
              {ev.title}
            </h3>
            {today && (
              <span
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 800,
                  padding: "2px 7px",
                  borderRadius: 99,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  background: categoryColor,
                  color: onSolid(categoryColor),
                }}
              >
                Today
              </span>
            )}
          </div>

          {/* Time + duration */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
            <Clock size={12} style={{ color: categoryColor, flexShrink: 0 }} />
            <span style={{ fontSize: "0.8rem", fontWeight: 600, color: theme.textPrimary }}>
              {fmtTime(ev.start, ev.isAllDay)}
              {ev.end && !ev.isAllDay && (
                <span style={{ color: theme.textMuted, fontWeight: 500 }}> – {fmtTime(ev.end, false)}</span>
              )}
            </span>
            {dur && (
              <span
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  padding: "1px 7px",
                  borderRadius: 99,
                  background: `${categoryColor}22`,
                  color: readableOnTint(categoryColor, "22", theme.surface),
                }}
              >
                {dur}
              </span>
            )}
          </div>

          {/* Location */}
          {ev.location && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <MapPin size={12} style={{ color: categoryColor, flexShrink: 0 }} />
              <span style={{ fontSize: "0.78rem", color: theme.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {ev.location}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Portal-like fixed popup — rendered outside the row so it doesn't affect layout */}
      {hovered && (
        <EventPopup
          ev={ev}
          categoryColor={categoryColor}
          rowRef={rowRef}
          isMobile={isMobile}
          onClose={() => setHovered(false)}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        />
      )}
    </>
  );
}

/* ─────────────────────────────────────────────
   Category Filter Bar
───────────────────────────────────────────── */
function CategoryFilterBar({
  catMeta,
  selected,
  onChange,
}: {
  catMeta: Record<string, { icon: string; label: string; color: string }>;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const { theme } = useTheme();
  const cats = Object.entries(catMeta);
  const allSelected = selected.size === 0;

  const toggle = (key: string) => {
    if (allSelected) {
      // Solo this category — turn off all others
      onChange(new Set([key]));
      return;
    }
    const next = new Set(selected);
    if (next.has(key)) {
      // Deselecting — if it would empty the set, go back to All
      next.delete(key);
      onChange(next.size === 0 ? new Set() : next);
    } else {
      // Adding another category
      next.add(key);
      // If all categories are now selected, revert to All
      onChange(next.size === cats.length ? new Set() : next);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px", marginBottom: "16px" }}>
      <button
        onClick={() => onChange(new Set())}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "4px 12px", borderRadius: 99, fontSize: "0.75rem", fontWeight: 700,
          cursor: "pointer",
          border: `1.5px solid ${allSelected ? theme.primary : theme.border}`,
          background: allSelected ? `${theme.primary}22` : "transparent",
          color: allSelected ? readableOnTint(theme.primary, "22", theme.bg) : theme.textMuted,
          transition: "all 0.15s", outline: "none",
        }}
      >
        All
      </button>
      {cats.map(([key, { icon, label, color }]) => {
        const active = !allSelected && selected.has(key);
        return (
          <button
            key={key}
            onClick={() => toggle(key)}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "4px 11px", borderRadius: 99, fontSize: "0.75rem", fontWeight: 700,
              cursor: "pointer",
              border: `1.5px solid ${active ? color : theme.border}`,
              background: active ? `${color}22` : "transparent",
              color: active ? readableOnTint(color, "22", theme.bg) : theme.textMuted,
              transition: "all 0.15s", outline: "none",
            }}
          >
            <CategoryIcon icon={icon} size={12} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Category Cards grid
───────────────────────────────────────────── */

// Cards are sized for this many event rows; 5 or more events scroll.
// Keep in sync with MAX_VISIBLE_ROWS in the CalendarCats plugin (assets/wpcc.js).
const MAX_VISIBLE = 4;

/**
 * Scrollable card body sized to exactly MAX_VISIBLE rows.
 *
 * Row heights vary (an event may or may not have a location line, a duration
 * chip, or sit under the "Earlier this period" divider), so a fixed pixel
 * height can't reliably equal "four items". We measure the first MAX_VISIBLE
 * children instead and cap the container there. Anything beyond that scrolls,
 * which keeps every card in a grid row the same height.
 */
function CardEventList({
  color,
  label,
  children,
}: {
  color: string;
  label: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState<number | null>(null);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const kids = Array.from(el.children) as HTMLElement[];

    // Walk the children until MAX_VISIBLE event rows are covered. The
    // "Earlier this period" divider counts towards the height but not the row
    // budget.
    let seen = 0;
    let last: HTMLElement | null = null;
    let covered = 0;

    for (let i = 0; i < kids.length; i++) {
      const isDivider = kids[i].dataset.divider === "true";
      if (!isDivider && seen >= MAX_VISIBLE) break;
      last = kids[i];
      covered = i + 1;
      if (!isDivider) seen++;
    }

    if (!last || covered >= kids.length) {
      setMaxHeight(null);
      return;
    }

    // Measure from the container's top edge to the last visible row's bottom
    // edge rather than summing offsetHeight, so row margins are included.
    // Rects are viewport-relative, so unscroll first.
    const prevScroll = el.scrollTop;
    el.scrollTop = 0;
    const h =
      last.getBoundingClientRect().bottom -
      el.getBoundingClientRect().top +
      parseFloat(getComputedStyle(el).paddingBottom);
    el.scrollTop = prevScroll;

    setMaxHeight(Math.ceil(h));
  }, []);

  useEffect(() => {
    // Measure after layout settles (fonts, wrapped titles).
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, [measure, children]);

  return (
    <div
      ref={ref}
      // WCAG 2.1.1 — beyond MAX_VISIBLE rows this region scrolls, so it needs
      // to be focusable or its 5th+ events are unreachable without a mouse.
      tabIndex={maxHeight === null ? undefined : 0}
      role={maxHeight === null ? undefined : "group"}
      aria-label={maxHeight === null ? undefined : `${label} events, scrollable list`}
      style={{
        overflowY: maxHeight === null ? "visible" : "auto",
        maxHeight: maxHeight === null ? "none" : maxHeight,
        padding: "6px 0 8px",
        scrollbarWidth: "thin",
        scrollbarColor: `${color}66 transparent`,
      }}
    >
      {children}
    </div>
  );
}

export default function CategoryCards({ grouped, selectedCats, onChangeSelectedCats, rememberFilter, onChangeRememberFilter }: Props) {
  const { theme } = useTheme();
  const { data: categoriesData } = useCategories();

  // Today at midnight for filtering past events
  const todayMid = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // Live order + groups straight from categories.json (via /admincat), not
  // a hardcoded frontend list — stays correct automatically when categories
  // are added, renamed, reordered, or moved between groups.
  const categoryOrder = useMemo(
    () => [...(categoriesData ?? [])].sort((a, b) => a.order - b.order).map(c => c.key),
    [categoriesData]
  );
  const categoryGroups = useMemo(
    () => buildCategoryGroups(categoriesData ?? []),
    [categoriesData]
  );

  if (!categoriesData) return null; // brief loading window before category order/groups are known

  const allCats = categoryOrder.filter(k => (grouped[k]?.length ?? 0) > 0);

  const catMeta: Record<string, { icon: string; label: string; color: string }> = {};
  for (const evList of Object.values(grouped)) {
    for (const ev of evList) {
      if (!catMeta[ev.category]) {
        catMeta[ev.category] = {
          icon: ev.categoryIcon,
          label: ev.categoryLabel,
          color: ev.categoryColor,
        };
      }
    }
  }

  // Apply category filter
  const visibleCats = selectedCats.size === 0
    ? allCats
    : allCats.filter(k => selectedCats.has(k));

  if (allCats.length === 0) {
    return (
      <div className="text-center py-20" style={{ color: theme.textMuted }}>
        No upcoming events in the selected range.
      </div>
    );
  }

  return (
    <div>
      <FilterTip remember={rememberFilter} onChangeRemember={onChangeRememberFilter} />
      <CategoryFilterBar catMeta={catMeta} selected={selectedCats} onChange={onChangeSelectedCats} />

      {visibleCats.length === 0 ? (
        <div className="text-center py-20" style={{ color: theme.textMuted }}>
          No events match the selected filters.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          {categoryGroups.map(group => {
            const groupCats = visibleCats.filter(k => group.keys.includes(k));
            if (groupCats.length === 0) return null;
            return (
              <div key={group.label}>
                {/* Group heading */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 12, marginBottom: 14,
                }}>
                  <div style={{
                    fontSize: "0.75rem", fontWeight: 800, textTransform: "uppercase",
                    letterSpacing: "0.14em", color: theme.textMuted,
                    fontFamily: theme.fontBody,
                  }}>
                    {group.label}
                  </div>
                  <div style={{ flex: 1, height: 1, background: theme.border }} />
                </div>

                {/* Cards grid */}
                <div
                  style={{
                    display: "grid",
                    gap: "12px",
                    gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
                  }}
                >
                  {groupCats.map(key => {
            const allEvents = grouped[key] ?? [];
            const meta = catMeta[key] ?? { icon: "📌", label: key, color: "#5A5A5A" };

            // Split into future (today onward) and past, each sorted ascending
            const futureEvents = allEvents
              .filter(ev => eventLastDay(ev) >= todayMid)
              .sort((a, b) => parseLocalDate(a.start).getTime() - parseLocalDate(b.start).getTime());
            const pastEvents = allEvents
              .filter(ev => eventLastDay(ev) < todayMid)
              .sort((a, b) => parseLocalDate(b.start).getTime() - parseLocalDate(a.start).getTime()); // most recent first

            // Total visible = future events up front; past events scroll below
            const totalEvents = allEvents.length;

            return (
              <div
                key={key}
                style={{
                  background: theme.surface,
                  border: `2px solid ${meta.color}`,
                  borderRadius: 16,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {/* Card header */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "14px 20px",
                    background: `${meta.color}1e`,
                    borderBottom: `2px solid ${meta.color}`,
                    flexShrink: 0,
                  }}
                >
                  <CategoryIcon icon={meta.icon} size={20} />
                  {/* h2 under the group's h2? No — groups use a plain label, so
                      category names are the page's second-level headings (1.3.1). */}
                  <h2
                    style={{
                      fontFamily: theme.fontBody,
                      fontSize: "0.8rem",
                      fontWeight: 800,
                      margin: 0,
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      // Category colours are admin-editable data, so they are
                      // corrected against the card header tint at render time.
                      color: readableOnTint(meta.color, "1e", theme.surface),
                    }}
                  >
                    {meta.label}
                  </h2>
                  <div
                    style={{
                      marginLeft: "auto",
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: meta.color,
                      color: onSolid(meta.color),
                      fontSize: "0.75rem",
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {totalEvents}
                  </div>
                </div>

                {/* Event rows — future first, scrollable, past below a divider */}
                {futureEvents.length === 0 && pastEvents.length === 0 ? (
                  <div
                    style={{
                      padding: "20px",
                      textAlign: "center",
                      fontSize: "0.8rem",
                      color: theme.textMuted,
                      fontStyle: "italic",
                    }}
                  >
                    No events in this range
                  </div>
                ) : (
                  <CardEventList color={meta.color} label={meta.label}>
                    {/* Future events (today onward) */}
                    {futureEvents.map(ev => (
                      <EventRow key={ev.id} ev={ev} categoryColor={meta.color} />
                    ))}

                    {/* Past events divider + rows */}
                    {pastEvents.length > 0 && (
                      <>
                        <div
                          data-divider="true"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            margin: "6px 14px",
                          }}
                        >
                          <div style={{ flex: 1, height: 1, background: theme.border }} />
                          <span
                            style={{
                              fontSize: "0.75rem",
                              fontWeight: 700,
                              textTransform: "uppercase",
                              letterSpacing: "0.1em",
                              color: theme.textMuted,
                            }}
                          >
                            Earlier this period
                          </span>
                          <div style={{ flex: 1, height: 1, background: theme.border }} />
                        </div>
                        {pastEvents.map(ev => (
                          // 0.45 dropped past events to ~2:1; 0.85 keeps the
                          // visual de-emphasis while staying above 4.5:1.
                          <div key={ev.id} style={{ opacity: 0.85 }}>
                            <EventRow ev={ev} categoryColor={meta.color} />
                          </div>
                        ))}
                      </>
                    )}
                  </CardEventList>
                )}
              </div>
            );
          })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
