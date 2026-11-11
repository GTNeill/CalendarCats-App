import { useTheme } from "../lib/theme";

/**
 * Explains how the category filter pills behave, and carries the optional
 * "Remember my filter" checkbox. Shared by the Cards and Calendar views so
 * the wording and control stay identical in both.
 */
export default function FilterTip({
  remember,
  onChangeRemember,
}: {
  remember: boolean;
  onChangeRemember: (next: boolean) => void;
}) {
  const { theme } = useTheme();

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: "8px 16px",
        marginBottom: "8px",
      }}
    >
      <div
        style={{
          fontSize: "0.75rem",
          color: theme.textMuted,
          lineHeight: 1.5,
        }}
      >
        Tap a category to show only that type of event. Tap more to add them to the view.
        Tap the same one again to remove it, or tap{" "}
        <strong style={{ color: theme.textMuted }}>All</strong> to reset.
      </div>

      <label
        title="Saves your chosen categories in a cookie on this device, so they're the default the next time you visit. Leave unchecked and your filter resets to All next visit."
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexShrink: 0,
          fontSize: "0.75rem",
          fontWeight: 600,
          color: remember ? theme.primaryText : theme.textMuted,
          cursor: "pointer",
          userSelect: "none",
          whiteSpace: "nowrap",
        }}
      >
        <input
          type="checkbox"
          checked={remember}
          onChange={e => onChangeRemember(e.target.checked)}
          style={{
            width: 13,
            height: 13,
            accentColor: theme.primary,
            cursor: "pointer",
          }}
        />
        Remember my filter
      </label>
    </div>
  );
}
