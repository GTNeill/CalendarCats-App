import { useRef } from "react";
import type { CalEvent } from "../lib/calendarUtils";
import { getDayRange, isSameDay, fmtTime, parseLocalDate } from "../lib/calendarUtils";
import CategoryIcon from "./CategoryIcon";

interface Props {
  events: CalEvent[];
  start: Date;
  end: Date;
}

function EventChip({ ev }: { ev: CalEvent }) {
  const time = fmtTime(ev.start, ev.isAllDay);
  return (
    <a
      href={ev.htmlLink ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      title={`${ev.title}${ev.location ? " @ " + ev.location : ""}`}
      className="block rounded px-1.5 py-1 mb-1 transition-opacity hover:opacity-80"
      style={{
        background: ev.categoryColor + "22",
        borderLeft: `2px solid ${ev.categoryColor}`,
        minWidth: 0,
        textDecoration: "none",
        cursor: "pointer",
      }}
    >
      <div
        className="text-[12px] font-medium leading-tight truncate transition-colors"
        style={{ color: "#F0F0F0" }}
        onMouseEnter={e => (e.currentTarget.style.color = "#C8A96E")}
        onMouseLeave={e => (e.currentTarget.style.color = "#F0F0F0")}
      >
        {ev.title}
      </div>
      <div className="text-[12px] mt-0.5" style={{ color: "#5A5A5A" }}>
        {time}
      </div>
    </a>
  );
}

export default function MonthTimeline({ events, start, end }: Props) {
  const days = getDayRange(start, end);

  const scrollRef = useRef<HTMLDivElement>(null);
  const didScroll = useRef(false);

  const handleScrollRef = (el: HTMLDivElement | null) => {
    (scrollRef as any).current = el;
    if (el && !didScroll.current) {
      didScroll.current = true;
      setTimeout(() => {
        const todayEl = el.querySelector("[data-today='true']") as HTMLElement;
        if (todayEl) {
          el.scrollLeft = todayEl.offsetLeft - 24;
        }
      }, 50);
    }
  };

  return (
    <div>
      {/* Horizontal scroll container */}
      <div
        ref={handleScrollRef}
        className="overflow-x-auto pb-4"
        style={{ scrollbarWidth: "thin" }}
      >
        <div className="flex gap-2" style={{ minWidth: "max-content" }}>
          {days.map(day => {
            const dayEvents = events
              .filter(ev => isSameDay(ev.start, day))
              .sort((a, b) => {
                if (a.isAllDay && !b.isAllDay) return -1;
                if (!a.isAllDay && b.isAllDay) return 1;
                return parseLocalDate(a.start).getTime() - parseLocalDate(b.start).getTime();
              });

            const isToday = day.toDateString() === new Date().toDateString();
            const isWeekend = day.getDay() === 0 || day.getDay() === 6;
            const dayName = day.toLocaleString("en-US", { weekday: "short" });
            const dayNum = day.getDate();
            const monthShort = day.toLocaleString("en-US", { month: "short" });
            const showMonth = day.getDate() === 1 || days.indexOf(day) === 0;

            return (
              <div
                key={day.toISOString()}
                data-today={isToday ? "true" : "false"}
                className="flex-shrink-0 rounded-lg overflow-hidden"
                style={{
                  width: 120,
                  background: isToday ? "#1a1410" : "#141414",
                  border: isToday ? "1px solid #C8A96E44" : "1px solid #2A2A2A",
                }}
              >
                {/* Day header */}
                <div
                  className="px-2 py-2 border-b text-center"
                  style={{
                    borderColor: isToday ? "#C8A96E33" : "#2A2A2A",
                    background: isToday ? "#1f180a" : isWeekend ? "#161616" : "transparent",
                  }}
                >
                  {showMonth && (
                    <div className="text-[12px] uppercase tracking-widest mb-0.5" style={{ color: "#5A5A5A" }}>
                      {monthShort}
                    </div>
                  )}
                  <div
                    className="text-lg font-bold leading-none"
                    style={{ color: isToday ? "#C8A96E" : isWeekend ? "#7a7a7a" : "#F0F0F0" }}
                  >
                    {dayNum}
                  </div>
                  <div
                    className="text-[12px] uppercase tracking-wide mt-0.5"
                    style={{ color: isToday ? "#C8A96E88" : "#5A5A5A" }}
                  >
                    {dayName}
                  </div>
                  {isToday && (
                    <div
                      className="text-[12px] font-bold uppercase tracking-widest mt-1 px-1.5 py-0.5 rounded mx-auto inline-block"
                      style={{ background: "#C8A96E", color: "#0A0A0A" }}
                    >
                      Today
                    </div>
                  )}
                </div>

                {/* Events */}
                <div className="p-1.5" style={{ minHeight: 40 }}>
                  {dayEvents.length === 0 ? (
                    <div className="text-center py-2" style={{ color: "#2a2a2a", fontSize: 12 }}>
                      —
                    </div>
                  ) : (
                    dayEvents.map(ev => <EventChip key={ev.id} ev={ev} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 pt-4 border-t flex flex-wrap gap-x-4 gap-y-2" style={{ borderColor: "#2A2A2A" }}>
        {Object.entries(
          events.reduce((acc, ev) => {
            acc[ev.category] = { label: ev.categoryLabel, color: ev.categoryColor, icon: ev.categoryIcon };
            return acc;
          }, {} as Record<string, { label: string; color: string; icon: string }>)
        ).map(([key, { label, color, icon }]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: color }} />
            <span className="text-[12px]" style={{ color: "#5A5A5A", display: "inline-flex", alignItems: "center", gap: 3 }}><CategoryIcon icon={icon} size={11} /> {label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
