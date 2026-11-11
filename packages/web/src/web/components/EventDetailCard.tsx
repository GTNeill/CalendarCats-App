import type { CalEvent } from "../lib/calendarUtils";
import { fmtDayNum, fmtMonthShort, fmtWeekday, fmtTime, fmtDuration, linkifyDescription, googleMapsUrl, googleCalendarAddUrl, isMultiDay, eventLastDay } from "../lib/calendarUtils";
import { MapPin, Clock, ExternalLink, User, Calendar, AlarmClock, CalendarPlus } from "lucide-react";
import { useTheme } from "../lib/theme";
import { readableOn, readableOnTint } from "../lib/a11y";
import CategoryIcon from "./CategoryIcon";
/**
 * Static, wide version of the Google Calendar–style event popup.
 * Used for search results — same visual language as the hover popup
 * (CategoryCards/CalendarGrid EventPopup) but rendered inline in a list
 * rather than floating, and roughly 2x the width for easier reading.
 */

// Left indent so the body content lines up with the title, not the card
// edge — accounts for the header's left padding + date badge width + gap.
const CARD_PADDING_X = 20;
const DATE_BADGE_WIDTH = 70; // minWidth(52) + padding(8*2) + border(1*2)
const HEADER_GAP = 14;
const DETAIL_INDENT = CARD_PADDING_X + DATE_BADGE_WIDTH + HEADER_GAP;

export default function EventDetailCard({ ev }: { ev: CalEvent }) {
  const { theme } = useTheme();
  const categoryColor = ev.categoryColor;

  // ev.sources lists every publisher of a merged event, primary first, so
  // drop the primary (already shown above) and any duplicate of it.
  const alsoListedBy = (ev.sources ?? []).filter(s => s && s !== ev.organizer);

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

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 960,
        background: theme.popupBg,
        border: `1.5px solid ${theme.popupBorder}`,
        borderRadius: 14,
        boxShadow: theme.mode === "dark"
          ? "0 2px 14px rgba(0,0,0,0.45)"
          : "0 2px 14px rgba(0,0,0,0.10)",
        overflow: "hidden",
      }}
    >
      {/* Colour bar */}
      <div style={{ height: 6, background: categoryColor }} />

      {/* Header */}
      <div style={{ padding: "16px 20px 10px", display: "flex", alignItems: "flex-start", gap: 14 }}>
        {/* Date badge — same style as the compact card's date column */}
        <div
          className="flex-shrink-0 text-center"
          style={{
            minWidth: 52,
            padding: "6px 8px",
            borderRadius: 8,
            background: `${categoryColor}14`,
            border: `1px solid ${categoryColor}44`,
          }}
        >
          <div style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, color: readableOnTint(categoryColor, "14", theme.popupBg) }}>
            {fmtWeekday(ev.start)}
          </div>
          <div style={{ fontSize: "1.4rem", fontWeight: 800, lineHeight: 1.1, color: theme.textPrimary }}>
            {fmtDayNum(ev.start)}
          </div>
          <div style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, color: readableOnTint(categoryColor, "14", theme.popupBg) }}>
            {fmtMonthShort(ev.start)}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
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
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h3
              style={{
                fontSize: "1.1rem",
                fontWeight: 700,
                margin: 0,
                lineHeight: 1.3,
                color: theme.textPrimary,
              }}
            >
              {ev.title}
            </h3>
            {ev.htmlLink && (
              <ExternalLink size={14} style={{ color: theme.textMuted, flexShrink: 0 }} />
            )}
          </div>
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: theme.border, margin: "0 20px" }} />

      {/* Body — indented to align with the title above, not the card edge */}
      <div style={{ padding: `14px 20px 18px ${DETAIL_INDENT}px`, display: "flex", flexDirection: "column", gap: 12 }}>

        {/* Date + time + duration */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <Clock size={15} style={{ color: categoryColor, flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontSize: "0.9rem", fontWeight: 600, color: theme.textPrimary }}>
              {dateLine}
            </div>
            <div style={{ fontSize: "0.82rem", color: theme.textMuted, marginTop: 1 }}>
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

        {/* Location — clickable, opens Google Maps */}
        {ev.location && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <MapPin size={15} style={{ color: categoryColor, flexShrink: 0, marginTop: 2 }} />
            <a
              href={googleMapsUrl(ev.location)}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: "0.85rem",
                color: theme.textMuted,
                lineHeight: 1.4,
                textDecoration: "none",
              }}
              onMouseEnter={e => { e.currentTarget.style.color = categoryColor; e.currentTarget.style.textDecoration = "underline"; }}
              onMouseLeave={e => { e.currentTarget.style.color = theme.textMuted; e.currentTarget.style.textDecoration = "none"; }}
            >
              {ev.location}
            </a>
          </div>
        )}

        {/* Description — links inside (markdown or raw HTML) become clickable */}
        {ev.description && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <AlarmClock size={15} style={{ color: categoryColor, flexShrink: 0, marginTop: 2 }} />
            <div
              style={{
                fontSize: "0.82rem",
                color: theme.textMuted,
                lineHeight: 1.55,
                maxHeight: 96,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 4,
                WebkitBoxOrient: "vertical",
              }}
              dangerouslySetInnerHTML={{ __html: linkifyDescription(ev.description, categoryColor) }}
            />
          </div>
        )}

        {/* Organizer, plus any other org that published the same event.
            Overlapping service areas mean one event is often listed by
            several sources; the API merges those, and this keeps the merge
            visible instead of silently dropping a publisher's credit. */}
        {ev.organizer && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <User size={15} style={{ color: categoryColor, flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: "0.82rem", color: theme.textMuted }}>
              <div>{ev.organizer}</div>
              {alsoListedBy.length > 0 && (
                <div style={{ fontSize: "0.76rem", opacity: 0.85, marginTop: 2 }}>
                  Also listed by {alsoListedBy.join(", ")}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Calendar label */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Calendar size={15} style={{ color: categoryColor, flexShrink: 0 }} />
          <div style={{ fontSize: "0.82rem", color: theme.textMuted }}>{ev.categoryLabel}</div>
        </div>

        {/* Links */}
        <div style={{ height: 1, background: theme.border }} />
        {ev.htmlLink && (
          <a
            href={ev.htmlLink}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}
          >
            <ExternalLink size={14} style={{ color: categoryColor }} />
            <span style={{ fontSize: "0.82rem", fontWeight: 600, color: readableOn(categoryColor, theme.popupBg) }}>
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
          <CalendarPlus size={14} style={{ color: categoryColor }} />
          <span style={{ fontSize: "0.82rem", fontWeight: 600, color: readableOn(categoryColor, theme.popupBg) }}>
            Add to my calendar
          </span>
        </a>
      </div>
    </div>
  );
}
