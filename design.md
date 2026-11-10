# CalendarCats — Design System

_Last synced with the live app: reflects the actual theme, categories, and components in production._

## Brand
- App name: **Community Calendar**
- Audience: public-facing, community residents
- Vibe: matches thegreaterrockwell.org — clean civic/editorial, deep purple + lavender, light by default, dark mode available
- Alderperson: Andre Vasquez

## Colors

Two theme modes, toggled via the header sun/moon button (light is default). Palette matched from
thegreaterrockwell.org (deep purple, lavender, near-black text, light gray, white). Red is kept as
a small secondary accent only (top bar, footer bar, error/status states) — it isn't part of GRW's
own palette, but wasn't removed.

**Light mode**
```
bg:            #ffffff
bg-header:     #fffffff5 (translucent, blurred sticky header)
surface:       #f2f2f2   (cards, panels, inputs — GRW's own section gray)
border:        #e2d8ea
text-primary:  #262626
text-muted:    #595959
text-faint:    #767676
accent (red):  #CF2C28   (top bar, badges, error states, save button)
primary:       #3e1859   (GRW's own deep purple — active controls, tabs, links, primary actions)
primary-text:  #3e1859   (same purple, safe as foreground text, ~13:1 on white)
row-hover:     #f7f2fa
event-border:  #e2d8ea
popup-bg:      #ffffff
popup-border:  #c99fe8   (GRW's own lavender accent)
```

**Dark mode**
```
bg:            #1a0f22
bg-header:     #1a0f22ee
surface:       #241531
border:        #3d2650
text-primary:  #f3edf7
text-muted:    #c3b0d6
text-faint:    #a68fc0
accent (red):  #CF2C28   (same red across both modes)
primary:       #8a5cc4   (brighter than GRW's own #3e1859 so it reads on a dark bg, fill only)
primary-text:  #c99fe8   (GRW's own lavender, safe as foreground on dark bg)
row-hover:     #2a1a38
event-border:  #3d2650
popup-bg:      #1f1329
popup-border:  #4a2f63
```

## Category Colors (current 15 categories, in display order)

| # | Key | Label | Icon | Color | Group |
|---|---|---|---|---|---|
| 0 | ward | Ward Office | 🏛️ | `#CF2C28` | Government |
| 1 | zoning | Zoning & Development | 🏗️ | `#e07b39` | Government |
| 2 | publicSafety | Public Safety | 🚔 | `#1a6fbf` | Community |
| 3 | community | Community Events | 🤝 | `#147671` | Community |
| 4 | environment | Environment & Parks | 🌿 | `#2d8a4e` | Community |
| 5 | arts | Arts & Culture | 🎭 | `#7c3d9e` | Community |
| 6 | health | Health & Wellness | 🩺 | `#1a9e72` | Community |
| 7 | education | Education & Learning | 🎓 | `#3b6dbf` | Community |
| 8 | immigration | Immigration & Rights | 🌐 | `#d47a1e` | Government |
| 9 | food | Food & Markets | 🍎 | `#c44e2a` | Community |
| 10 | celebrations | Celebrations & Holidays | 🎊 | `#d4a017` | Community |
| 11 | social | Social & Gatherings | 🎉 | `#b03070` | Community |
| 12 | housing | Housing & Property | 🏠 | `#5c7a3e` | Government |
| 13 | ainslieArts | Ainslie Arts Plaza | 🎪 | `#c026d3` | Community |
| 14 | other | Other (catch-all) | 📌 | `#5A5A5A` | Community |

Categories are fully editable at `/admincat` — this table reflects current data, not hardcoded design. See `ADMIN-GUIDE.md`.

## Typography
- Display/Headers: `'Work Sans', 'Arial', sans-serif`, weight 700 — app title "Community Calendar", month/year label, modal headings
- Body/UI: `'Work Sans', 'Arial', sans-serif` — everything else
- Monospace: used for category `key` fields in the admin page only
- Scale: ~0.6rem micro-labels → 0.72–0.85rem body/meta → 1rem–1.85rem headings

## Layout
- Max width: 1152px, centered
- Gutter: 48px sides, 40px top (main content)
- Card grid: `auto-fill, minmax(340px, 1fr)`, 12px gap
- Calendar/timeline view: month grid or week columns depending on selected unit

## Components

- **Header** (sticky, blurred backdrop): logo/title left; Week/Month toggle, Prev/Today/Next, Cards/Calendar tab switcher, Refresh (icon-only, tooltip), theme toggle (icon-only, tooltip) — right
- **Zoom slider**: vertical slider fixed to the top-right of the content area (below header, not part of it). 75%–150% range, scales all content text/layout via CSS `zoom`. Includes +/- buttons and a click-to-reset percentage label.
- **Search bar**: text input above the filter row. Searches title, location, description, and category label — scoped to whatever date range/view is currently loaded (not the whole calendar). Clearing it returns to the normal Cards/Calendar view.
- **Category Filter Bar**: pill buttons per category (icon + label), "All" resets. Tap to solo a category, tap more to add others, tap the same one again to remove it.
- **Category Card** (Cards view): white/dark surface, colored top accent + left border, header with icon + label, event rows below, past/future split with scroll for overflow.
- **Event Row** (compact, in Cards view): date badge (weekday/day-number/month, colored) + title/time/location. Hover reveals a floating Google Calendar–style popup (`pointer-events: none`, purely informational, not clickable).
- **Event Detail Card** (wide, in Search Results): same visual language as the hover popup but static, ~960px wide, clickable throughout — location links to Google Maps, description links are parsed and clickable (including unwrapping Google's redirect URLs), category badge, duration pill, and "Open in Google Calendar" link. Body content indents to align with the title, not the card edge.
- **Timeline/Calendar Grid**: month or week grid, events plotted by actual day/time, same floating popup on hover as Cards view.
- **TODAY badge**: colored per active category, uppercase, small pill.
- **Admin Category Manager** (`/admincat`): full CRUD table — reorder (▲▼), key/icon/color/label/hex/group fields, chip-style keyword editor, add/delete rows, live "Your Government" vs "Your Community" group preview, unsaved-changes indicator, save button.

## Motion
- Tab switch: instant (no transition currently)
- Card/row hover: background + border-color transition ~150–180ms, no transform
- Zoom slider: live CSS `zoom` update, no animation
- Auto-refresh: silent background refetch every 4 hours during daytime (6am–6pm); manual refresh always available

## UX Patterns
- Loading: skeleton shimmer (`SkeletonCards`, `SkeletonTimeline`)
- Error state: red banner with retry button if the calendar feed fails to load
- Empty state: "No events match the selected filters" / "No events match '<query>' in the current view"
- All interactive header controls have native `title` tooltips
- Times are always Central Time (America/Chicago), DST-aware automatically — no manual seasonal adjustment needed
- Accessibility: zoom slider for text/content scaling, in addition to standard browser zoom
