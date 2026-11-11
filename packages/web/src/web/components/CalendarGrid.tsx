import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { CalEvent } from "../lib/calendarUtils";
import {
  parseLocalDate, fmtTime, fmtDuration, fmtWeekday, fmtDayNum, fmtMonthShort,
  isSameDay, googleCalendarAddUrl, eventOccursOnDay, eventLastDay, isMultiDay,
} from "../lib/calendarUtils";
import { Clock, MapPin, User, Calendar, AlarmClock, ExternalLink, X, CalendarPlus } from "lucide-react";
import { useTheme } from "../lib/theme";
import { readableOn, readableOnTint, onSolid } from "../lib/a11y";
import { useIsMobile } from "../hooks/useIsMobile";
import { useCategories } from "../hooks/useCategories";
import CategoryIcon from "./CategoryIcon";
import FilterTip from "./FilterTip";

type RangeUnit = "day" | "week" | "month";

interface Props {
  events: CalEvent[];
  start: Date;
  end: Date;
  unit: RangeUnit;
  /** Lifted to the page so Cards and Calendar share one selection — see useCategoryFilter. */
  selectedCats: Set<string>;
  onChangeSelectedCats: (next: Set<string>) => void;
  /** Whether the visitor has opted in to remembering this filter across visits. */
  rememberFilter: boolean;
  onChangeRememberFilter: (next: boolean) => void;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* ─── Popup ─────────────────────────────────────────────────── */
function EventPopup({
  ev,
  anchorRef,
  isMobile,
  onClose,
  onMouseEnter,
  onMouseLeave,
}: {
  ev: CalEvent;
  anchorRef: React.RefObject<HTMLElement | null>;
  isMobile?: boolean;
  onClose?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const { theme } = useTheme();
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const cat = ev.categoryColor;
  const titleId = `grid-popup-title-${ev.id}`;

  useEffect(() => {
    if (!anchorRef.current || !popupRef.current) return;
    const anchor = anchorRef.current.getBoundingClientRect();
    const popup = popupRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const GAP = 10;

    if (isMobile) {
      const left = Math.max(8, Math.min((vw - popup.width) / 2, vw - popup.width - 8));
      let top = anchor.bottom + GAP;
      if (top + popup.height > vh - 8) top = anchor.top - popup.height - GAP;
      top = Math.max(8, Math.min(top, vh - popup.height - 8));
      setPos({ top, left });
      return;
    }

    let left = anchor.right + GAP;
    if (left + popup.width > vw - 8) left = anchor.left - popup.width - GAP;
    let top = anchor.top + anchor.height / 2 - popup.height / 2;
    top = Math.max(8, Math.min(top, vh - popup.height - 8));
    setPos({ top, left });
  }, [anchorRef, isMobile]);

  const dur = fmtDuration(ev.start, ev.end, ev.isAllDay);
  // Some sources (events RSS) publish a start with no end. Render those
  // start-only rather than leaving a dangling en-dash.
  const timeStr = ev.isAllDay
    ? "All day"
    : ev.end
      ? `${fmtTime(ev.start, false)} – ${fmtTime(ev.end, false)}`
      : fmtTime(ev.start, false);
  // A multi-day event's popup shows its full span, e.g. "Sep 23 – Sep 25",
  // rather than just the start day — clicking any of its continuation chips
  // should read the same regardless of which day you opened it from.
  const multiDay = isMultiDay(ev);
  const lastDay = eventLastDay(ev);
  const dateLine = multiDay
    ? `${fmtMonthShort(ev.start)} ${fmtDayNum(ev.start)} – ${lastDay.toLocaleString("en-US", { month: "short" })} ${lastDay.getDate()}`
    : `${fmtWeekday(ev.start)}, ${fmtMonthShort(ev.start)} ${fmtDayNum(ev.start)}`;

  return (
    <div
      ref={popupRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "fixed",
        zIndex: 9999,
        width: isMobile ? "calc(100vw - 32px)" : 300,
        maxWidth: 300,
        top: pos ? pos.top : -9999,
        left: pos ? pos.left : -9999,
        background: theme.popupBg,
        border: `1.5px solid ${theme.popupBorder}`,
        borderRadius: 12,
        boxShadow:
          theme.mode === "dark"
            ? "0 0 0 1px #000, 0 12px 48px rgba(0,0,0,0.85), 0 2px 10px rgba(0,0,0,0.6)"
            : "0 0 0 1px rgba(0,0,0,0.08), 0 12px 48px rgba(0,0,0,0.22), 0 2px 10px rgba(0,0,0,0.12)",
        // Interactive on both mobile and desktop, so links inside are clickable.
        pointerEvents: "auto",
        overflow: "hidden",
      }}
    >
      <div style={{ height: 5, background: cat }} />
      {isMobile && (
        <button
          onClick={onClose}
          aria-label="Close"
          title="Close"
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            width: 24,
            height: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 7,
            border: "none",
            background: theme.mode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
            color: theme.textMuted,
            cursor: "pointer",
          }}
        >
          <X size={13} />
        </button>
      )}
      <div style={{ padding: "12px 14px 8px" }}>
        <div style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: readableOn(cat, theme.popupBg), marginBottom: 3 }}>
          <CategoryIcon icon={ev.categoryIcon} size={12} /> {ev.categoryLabel}
        </div>
        <div id={titleId} style={{ fontSize: "0.95rem", fontWeight: 700, lineHeight: 1.3, color: theme.textPrimary }}>
          {ev.title}
        </div>
      </div>
      <div style={{ height: 1, background: theme.border, margin: "0 14px" }} />
      <div style={{ padding: "10px 14px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <Clock size={13} style={{ color: cat, flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontSize: "0.82rem", fontWeight: 600, color: theme.textPrimary }}>
              {dateLine}
            </div>
            <div style={{ fontSize: "0.76rem", color: theme.textMuted, marginTop: 1 }}>
              {timeStr}
              {dur && (
                <span style={{ marginLeft: 7, padding: "1px 6px", borderRadius: 99, background: `${cat}22`, color: readableOnTint(cat, "22", theme.popupBg), fontSize: "0.75rem", fontWeight: 700 }}>
                  {dur}
                </span>
              )}
            </div>
          </div>
        </div>
        {ev.location && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <MapPin size={13} style={{ color: cat, flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: "0.78rem", color: theme.textMuted, lineHeight: 1.4 }}>{ev.location}</div>
          </div>
        )}
        {ev.description && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <AlarmClock size={13} style={{ color: cat, flexShrink: 0, marginTop: 2 }} />
            <div
              style={{ fontSize: "0.75rem", color: theme.textMuted, lineHeight: 1.5, maxHeight: 64, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}
              dangerouslySetInnerHTML={{ __html: ev.description.replace(/<[^>]*>/g, " ").trim() }}
            />
          </div>
        )}
        {ev.organizer && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <User size={13} style={{ color: cat, flexShrink: 0 }} />
            <div style={{ fontSize: "0.75rem", color: theme.textMuted }}>{ev.organizer}</div>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Calendar size={13} style={{ color: cat, flexShrink: 0 }} />
          <div style={{ fontSize: "0.75rem", color: theme.textMuted }}>{ev.categoryLabel}</div>
        </div>
        <div style={{ height: 1, background: theme.border }} />
        {ev.htmlLink && (
          <a
            href={ev.htmlLink}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", gap: 7, textDecoration: "none" }}
          >
            <ExternalLink size={12} style={{ color: cat }} />
            <span style={{ fontSize: "0.75rem", fontWeight: 600, color: cat }}>Open in Google Calendar</span>
          </a>
        )}
        <a
          href={googleCalendarAddUrl(ev)}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: "flex", alignItems: "center", gap: 7, textDecoration: "none" }}
        >
          <CalendarPlus size={12} style={{ color: cat }} />
          <span style={{ fontSize: "0.75rem", fontWeight: 600, color: cat }}>Add to my calendar</span>
        </a>
      </div>
    </div>
  );
}

/* ─── Event Chip ─────────────────────────────────────────────── */
function EventChip({ ev, date }: { ev: CalEvent; date?: Date }) {
  const { theme } = useTheme();
  const isMobile = useIsMobile();
  // Multi-day events now render on every day they span (see eventOccursOnDay),
  // so a chip on any day after the event's start is a continuation — show
  // that instead of the (misleading, day-1-only) start time.
  const isContinuation = !!date && !isSameDay(ev.start, date);
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cat = ev.categoryColor;

  // Hide is delayed (and cancelable) so the mouse can travel from the chip
  // across the small gap into the popup to click a link inside it.
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  }, []);
  const scheduleHide = useCallback(() => {
    cancelHide();
    hideTimerRef.current = setTimeout(() => setHovered(false), 250);
  }, [cancelHide]);

  const enter = useCallback(() => {
    if (isMobile) return;
    cancelHide();
    timerRef.current = setTimeout(() => setHovered(true), 280);
  }, [isMobile, cancelHide]);
  const leave = useCallback(() => {
    if (isMobile) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    scheduleHide();
  }, [isMobile, scheduleHide]);

  // Tapping a chip on mobile shows the detail popup instead of navigating
  // straight to Google Calendar; tapping outside closes it.
  // WCAG 2.1.2 — Escape dismisses the popup regardless of where focus is.
  useEffect(() => {
    if (!hovered) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setHovered(false);
        ref.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hovered]);

  useEffect(() => {
    if (!isMobile || !hovered) return;
    const handleOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setHovered(false);
      }
    };
    document.addEventListener("click", handleOutside, true);
    return () => document.removeEventListener("click", handleOutside, true);
  }, [isMobile, hovered]);

  return (
    <>
      <div
        ref={ref}
        role="button"
        tabIndex={0}
        aria-expanded={hovered}
        aria-label={
          isContinuation
            ? `${ev.title}, continued from ${fmtWeekday(ev.start)} ${fmtMonthShort(ev.start)} ${fmtDayNum(ev.start)}`
            : `${ev.title}, ${fmtWeekday(ev.start)} ${fmtMonthShort(ev.start)} ${fmtDayNum(ev.start)}, ${fmtTime(ev.start, ev.isAllDay)}`
        }
        onMouseEnter={enter}
        onMouseLeave={leave}
        onKeyDown={e => {
          // WCAG 2.1.1 — chips are the only way into an event from the grid.
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (isMobile) { setHovered(v => !v); return; }
            if (ev.htmlLink) window.open(ev.htmlLink, "_blank", "noopener,noreferrer");
            return;
          }
          if (e.key === "Escape" && hovered) { e.stopPropagation(); setHovered(false); }
        }}
        style={{
          display: "flex",
          alignItems: "flex-start",       // top-align icon with wrapped text
          gap: 5,
          padding: "3px 6px",
          borderRadius: 5,
          marginBottom: 2,
          background: hovered ? `${cat}33` : `${cat}1a`,
          borderLeft: `2px solid ${cat}`,
          cursor: "pointer",
          transition: "background 0.15s",
        }}
        onClick={(e) => {
          if (isMobile) {
            e.preventDefault();
            setHovered(v => !v);
            return;
          }
          if (ev.htmlLink) window.open(ev.htmlLink, "_blank", "noopener,noreferrer");
        }}
      >
        {/* dot / diamond — flex-shrink so it stays tiny; a continuation chip
            gets a right-pointing arrow instead, to read as "still going". */}
        <span style={{ fontSize: "0.75rem", color: readableOnTint(cat, "1a", theme.bg), fontWeight: 800, flexShrink: 0, marginTop: "0.2em" }}>
          {isContinuation ? "▸" : ev.isAllDay ? "●" : "◆"}
        </span>
        {/* Title wraps freely; no truncation */}
        <span
          style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            color: hovered ? readableOnTint(cat, "1a", theme.bg) : theme.textPrimary,
            transition: "color 0.15s",
            lineHeight: 1.4,
            wordBreak: "break-word",
            minWidth: 0,
          }}
        >
          {isContinuation ? (
            <span style={{ color: readableOnTint(cat, "1a", theme.bg), marginRight: 4, fontSize: "0.75rem", fontWeight: 700, whiteSpace: "nowrap", fontStyle: "italic" }}>
              cont'd
            </span>
          ) : !ev.isAllDay && (
            <span style={{ color: readableOnTint(cat, "1a", theme.bg), marginRight: 4, fontSize: "0.75rem", fontWeight: 700, whiteSpace: "nowrap" }}>
              {fmtTime(ev.start, false).replace(":00", "").toLowerCase()}
            </span>
          )}
          {ev.title}
        </span>
      </div>
      {hovered && (
        <EventPopup
          ev={ev}
          anchorRef={ref as React.RefObject<HTMLElement | null>}
          isMobile={isMobile}
          onClose={() => setHovered(false)}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        />
      )}
    </>
  );
}

/* ─── Day Cell ───────────────────────────────────────────────── */
function DayCell({
  date,
  events,
  inMonth,
}: {
  date: Date;
  events: CalEvent[];
  inMonth: boolean;
}) {
  const { theme } = useTheme();
  const isToday = date.toDateString() === new Date().toDateString();
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;

  const sorted = [...events].sort((a, b) => {
    if (a.isAllDay && !b.isAllDay) return -1;
    if (!a.isAllDay && b.isAllDay) return 1;
    return parseLocalDate(a.start).getTime() - parseLocalDate(b.start).getTime();
  });

  return (
    <div
      style={{
        // No fixed minHeight — cell grows with content
        padding: "6px 6px 6px",
        background: isToday
          ? theme.mode === "dark" ? "#1a130a" : "#FFF7EC"
          : !inMonth
          ? theme.mode === "dark" ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.03)"
          : "transparent",
      }}
    >
      {/* Day number bubble — top-right */}
      <div style={{ marginBottom: 4, display: "flex", justifyContent: "flex-end" }}>
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.78rem",
            fontWeight: isToday ? 800 : 500,
            flexShrink: 0,
            background: isToday ? theme.accent : "transparent",
            color: isToday
              ? onSolid(theme.accent)
              : !inMonth
              ? theme.textFaint
              : isWeekend
              ? theme.textMuted
              : theme.textPrimary,
          }}
        >
          {date.getDate()}
        </div>
      </div>

      {/* Event chips — stacked, each wraps its own title */}
      <div>
        {sorted.map(ev => (
          <EventChip key={ev.id} ev={ev} date={date} />
        ))}
      </div>
    </div>
  );
}

/* ─── Day View (used by the Today filter) ───────────────────── */
function DayView({ events, start }: { events: CalEvent[]; start: Date }) {
  const { theme } = useTheme();
  const isToday = start.toDateString() === new Date().toDateString();
  const dayEvs = events.filter(ev => eventOccursOnDay(ev, start));
  const sorted = [...dayEvs].sort((a, b) => {
    if (a.isAllDay && !b.isAllDay) return -1;
    if (!a.isAllDay && b.isAllDay) return 1;
    return parseLocalDate(a.start).getTime() - parseLocalDate(b.start).getTime();
  });

  return (
    <div>
      {/* Day header — mirrors WeekView's per-day header, full width */}
      <div
        style={{
          padding: "14px 0",
          textAlign: "center",
          borderBottom: `1px solid ${theme.border}`,
          background: isToday
            ? theme.mode === "dark" ? "#1a130a" : "#FFF7EC"
            : "transparent",
        }}
      >
        <div style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: theme.textPrimary, opacity: isToday ? 1 : 0.7 }}>
          {DOW[start.getDay()]}
        </div>
        <div
          style={{
            margin: "6px auto 0",
            width: 34,
            height: 34,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "1.1rem",
            fontWeight: isToday ? 800 : 600,
            background: isToday ? theme.accent : "transparent",
            color: isToday ? onSolid(theme.accent) : theme.textPrimary,
          }}
        >
          {start.getDate()}
        </div>
      </div>

      {/* Agenda list for the day */}
      <div style={{ padding: "14px" }}>
        {sorted.length === 0 ? (
          <p style={{ textAlign: "center", padding: "24px 0", fontSize: "0.85rem", color: theme.textMuted, fontFamily: theme.fontBody }}>
            No events scheduled for this day.
          </p>
        ) : (
          sorted.map(ev => <EventChip key={ev.id} ev={ev} date={start} />)
        )}
      </div>
    </div>
  );
}

/* ─── Week View ──────────────────────────────────────────────── */
function WeekView({ events, start }: { events: CalEvent[]; start: Date }) {
  const { theme } = useTheme();
  const days: Date[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });

  return (
    <div>
      {/* DOW / date header */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: `1px solid ${theme.border}` }}>
        {days.map((d, i) => {
          const isToday = d.toDateString() === new Date().toDateString();
          const isWeekend = i === 0 || i === 6;
          return (
            <div
              key={i}
              style={{
                padding: "10px 0",
                textAlign: "center",
                borderRight: i < 6 ? `1px solid ${theme.border}` : undefined,
                background: isToday
                  ? theme.mode === "dark" ? "#1a130a" : "#FFF7EC"
                  : "transparent",
              }}
            >
              <div style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: isWeekend ? theme.textMuted : theme.textPrimary, opacity: isToday ? 1 : 0.7 }}>
                {DOW[i]}
              </div>
              <div
                style={{
                  margin: "4px auto 0",
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "1rem",
                  fontWeight: isToday ? 800 : 600,
                  background: isToday ? theme.accent : "transparent",
                  color: isToday ? "#0A0A0A" : isWeekend ? theme.textMuted : theme.textPrimary,
                }}
              >
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Cell row — each column stretches to tallest sibling */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", alignItems: "stretch" }}>
        {days.map((d, i) => {
          const dayEvs = events.filter(ev => eventOccursOnDay(ev, d));
          return (
            <div key={i} style={{ borderRight: i < 6 ? `1px solid ${theme.border}` : undefined }}>
              <DayCell date={d} events={dayEvs} inMonth={true} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Month View ─────────────────────────────────────────────── */
function MonthView({ events, start }: { events: CalEvent[]; start: Date }) {
  const { theme } = useTheme();
  const firstDay = new Date(start.getFullYear(), start.getMonth(), 1);
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - firstDay.getDay());

  const weeks: Date[][] = Array.from({ length: 6 }, (_, wi) =>
    Array.from({ length: 7 }, (_, di) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + wi * 7 + di);
      return d;
    })
  );

  const currentMonth = start.getMonth();

  return (
    <div>
      {/* DOW header */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: `1px solid ${theme.border}` }}>
        {DOW.map((d, i) => (
          <div
            key={d}
            style={{
              padding: "8px 0",
              textAlign: "center",
              fontSize: "0.75rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: i === 0 || i === 6 ? theme.textMuted : theme.textPrimary,
              borderRight: i < 6 ? `1px solid ${theme.border}` : undefined,
            }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Week rows */}
      {weeks.map((week, wi) => (
        <div
          key={wi}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            alignItems: "stretch",
            borderBottom: wi < 5 ? `1px solid ${theme.border}` : undefined,
          }}
        >
          {week.map((d, di) => {
            const inMonth = d.getMonth() === currentMonth;
            const dayEvs = events.filter(ev => eventOccursOnDay(ev, d));
            return (
              <div key={di} style={{ borderRight: di < 6 ? `1px solid ${theme.border}` : undefined }}>
                <DayCell date={d} events={dayEvs} inMonth={inMonth} />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ─── Category Filter Bar ────────────────────────────────────── */
interface FilterBarProps {
  events: CalEvent[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  remember: boolean;
  onChangeRemember: (next: boolean) => void;
}

function CategoryFilterBar({ events, selected, onChange, remember, onChangeRemember }: FilterBarProps) {
  const { theme } = useTheme();
  const { data: categoriesData } = useCategories();

  // Live order straight from categories.json, not a hardcoded frontend list.
  const categoryOrder = useMemo(
    () => [...(categoriesData ?? [])].sort((a, b) => a.order - b.order).map(c => c.key),
    [categoriesData]
  );

  // Derive which categories appear, ordered by the live category order
  const catMap = events.reduce((map, ev) => {
    if (!map.has(ev.category))
      map.set(ev.category, { key: ev.category, label: ev.categoryLabel, icon: ev.categoryIcon, color: ev.categoryColor });
    return map;
  }, new Map<string, { key: string; label: string; icon: string; color: string }>());
  const cats = categoryOrder.filter(k => catMap.has(k)).map(k => catMap.get(k)!);

  const allSelected = selected.size === 0;

  const toggle = (key: string) => {
    if (allSelected) {
      // Solo this category
      onChange(new Set([key]));
      return;
    }
    const next = new Set(selected);
    if (next.has(key)) {
      next.delete(key);
      onChange(next.size === 0 ? new Set() : next); // empty → back to All
    } else {
      next.add(key);
      onChange(next.size === cats.length ? new Set() : next); // all → back to All
    }
  };

  if (cats.length === 0) return null;

  return (
    <>
    <FilterTip remember={remember} onChangeRemember={onChangeRemember} />
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "6px",
        marginBottom: "16px",
      }}
    >
      {/* All button */}
      <button
        onClick={() => onChange(new Set())}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "4px 12px",
          borderRadius: 99,
          fontSize: "0.75rem",
          fontWeight: 700,
          cursor: "pointer",
          border: `1.5px solid ${allSelected ? theme.accent : theme.border}`,
          background: allSelected ? `${theme.accent}22` : "transparent",
          color: allSelected ? theme.accent : theme.textMuted,
          transition: "all 0.15s",
          outline: "none",
        }}
      >
        All
      </button>

      {/* Per-category buttons */}
      {cats.map(cat => {
        const active = !allSelected && selected.has(cat.key);
        return (
          <button
            key={cat.key}
            onClick={() => toggle(cat.key)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "4px 11px",
              borderRadius: 99,
              fontSize: "0.75rem",
              fontWeight: 700,
              cursor: "pointer",
              border: `1.5px solid ${active ? cat.color : theme.border}`,
              background: active ? `${cat.color}22` : "transparent",
              color: active ? cat.color : theme.textMuted,
              transition: "all 0.15s",
              outline: "none",
            }}
          >
            <CategoryIcon icon={cat.icon} size={13} />
            <span>{cat.label}</span>
          </button>
        );
      })}
    </div>
    </>
  );
}

/* ─── Main export ────────────────────────────────────────────── */
export default function CalendarGrid({ events, start, end, unit, selectedCats, onChangeSelectedCats, rememberFilter, onChangeRememberFilter }: Props) {
  const { theme } = useTheme();

  // Apply filter: empty set = All
  const filtered = selectedCats.size === 0
    ? events
    : events.filter(ev => selectedCats.has(ev.category));

  // Month/year header — if the visible range (e.g. a week) spans two
  // different months (or years), show both instead of picking one arbitrarily.
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const sameYear = start.getFullYear() === end.getFullYear();
  const monthYearLabel = unit === "day"
    ? start.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : sameMonth
    ? start.toLocaleString("en-US", { month: "long", year: "numeric" })
    : sameYear
    ? `${start.toLocaleString("en-US", { month: "long" })} – ${end.toLocaleString("en-US", { month: "long", year: "numeric" })}`
    : `${start.toLocaleString("en-US", { month: "long", year: "numeric" })} – ${end.toLocaleString("en-US", { month: "long", year: "numeric" })}`;

  return (
    <div>
      <CategoryFilterBar events={events} selected={selectedCats} onChange={onChangeSelectedCats} remember={rememberFilter} onChangeRemember={onChangeRememberFilter} />
      <div style={{ border: `1px solid ${theme.border}`, borderRadius: 12, overflow: "hidden" }}>
        {/* Month/year title bar — traditional calendar-page header cell */}
        <div
          style={{
            borderBottom: `1px solid ${theme.border}`,
            padding: "14px 0",
            textAlign: "center",
            fontFamily: theme.fontDisplay,
            fontWeight: 700,
            fontSize: "1.4rem",
            letterSpacing: "0.02em",
            color: theme.textPrimary,
          }}
        >
          {monthYearLabel}
        </div>
        {unit === "day"
          ? <DayView events={filtered} start={start} />
          : unit === "week"
          ? <WeekView events={filtered} start={start} />
          : <MonthView events={filtered} start={start} />}
      </div>
    </div>
  );
}
