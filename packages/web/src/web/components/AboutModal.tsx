import { useEffect, useRef } from "react";
import { X, ExternalLink, Mail } from "lucide-react";
import { useTheme } from "../lib/theme";
import { useSources } from "../hooks/useSources";
import { useIsMobile } from "../hooks/useIsMobile";
import { useSiteSettings } from "../hooks/useSiteSettings";

export default function AboutModal({ onClose }: { onClose: () => void }) {
  const { theme } = useTheme();
  const isMobile = useIsMobile();
  const { data: sources, isLoading, isError } = useSources();
  const { data: siteSettings } = useSiteSettings();
  const contactEmail = siteSettings?.contactEmail;
  const dialogRef = useRef<HTMLDivElement>(null);

  // Esc to close, and keep focus trapped in the dialog while it's open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: isMobile ? "flex-end" : "center",
        justifyContent: "center",
        padding: isMobile ? 0 : 16,
      }}
    >
      {/* Backdrop — a real button (not a div) so it's keyboard- and
          screen-reader-interactive by default; sits behind the dialog via
          z-index rather than relying on stopPropagation/click-through. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          border: "none",
          padding: 0,
          cursor: "default",
          background: theme.mode === "dark" ? "rgba(0,0,0,0.55)" : "rgba(11,42,51,0.35)",
        }}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-modal-title"
        tabIndex={-1}
        style={{
          position: "relative",
          zIndex: 1,
          width: isMobile ? "100%" : 480,
          maxWidth: "100%",
          maxHeight: isMobile ? "85vh" : "80vh",
          overflowY: "auto",
          background: theme.popupBg,
          border: `1.5px solid ${theme.popupBorder}`,
          borderRadius: isMobile ? "16px 16px 0 0" : 14,
          boxShadow: theme.mode === "dark"
            ? "0 0 0 1px #000, 0 12px 48px rgba(0,0,0,0.85)"
            : "0 0 0 1px rgba(0,0,0,0.08), 0 12px 48px rgba(0,0,0,0.22)",
        }}
      >
        <div style={{ height: 6, background: theme.primary }} />

        <div style={{ padding: "20px 24px 24px" }}>
          <div className="flex items-start justify-between" style={{ marginBottom: 12 }}>
            <h2
              id="about-modal-title"
              style={{
                fontFamily: theme.fontDisplay,
                fontWeight: 700,
                fontSize: "1.35rem",
                color: theme.textPrimary,
                letterSpacing: "0.01em",
                margin: 0,
              }}
            >
              About this calendar
            </h2>
            <button
              onClick={onClose}
              aria-label="Close"
              title="Close"
              style={{
                flexShrink: 0,
                width: 30,
                height: 30,
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
              <X size={16} />
            </button>
          </div>

          <p
            style={{
              fontFamily: theme.fontBody,
              fontSize: "0.9rem",
              lineHeight: 1.55,
              color: theme.textPrimary,
              margin: "0 0 18px",
            }}
          >
            This calendar brings together public events from several neighborhood
            organizations into one place, so you don't have to check each one
            separately. It's a community view, not any single organization's
            calendar — every event here still belongs to, and is run by, the
            group that posted it.
          </p>

          <h3
            style={{
              fontFamily: theme.fontBody,
              fontSize: "0.75rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: theme.textMuted,
              margin: "0 0 10px",
            }}
          >
            Where the events come from
          </h3>

          {isLoading && (
            <p style={{ fontFamily: theme.fontBody, fontSize: "0.85rem", color: theme.textMuted }}>
              Loading sources…
            </p>
          )}
          {isError && (
            <p style={{ fontFamily: theme.fontBody, fontSize: "0.85rem", color: theme.textMuted }}>
              Couldn't load the source list right now.
            </p>
          )}

          {sources && sources.length > 0 && (
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {sources.map((s, i) => (
                <li
                  key={`${s.name}-${i}`}
                  className="flex items-center justify-between"
                  style={{
                    padding: "10px 0",
                    borderTop: i === 0 ? "none" : `1px solid ${theme.border}`,
                    gap: 12,
                  }}
                >
                  <span
                    style={{
                      fontFamily: theme.fontBody,
                      fontSize: "0.88rem",
                      fontWeight: 600,
                      color: theme.textPrimary,
                    }}
                  >
                    {s.name}
                  </span>
                  {s.link && (
                    <a
                      href={s.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center"
                      style={{
                        flexShrink: 0,
                        gap: 5,
                        fontFamily: theme.fontBody,
                        fontSize: "0.78rem",
                        fontWeight: 600,
                        color: theme.primaryText,
                        textDecoration: "none",
                      }}
                    >
                      Visit site
                      <ExternalLink size={12} />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}

          <p
            style={{
              fontFamily: theme.fontBody,
              fontSize: "0.78rem",
              lineHeight: 1.5,
              color: theme.textMuted,
              margin: "18px 0 0",
            }}
          >
            Questions about a specific event, or want it corrected or removed?
            Reach out to the organization that posted it — the source list
            above is the fastest way to find who to contact.
          </p>

          {contactEmail && (
            <p
              style={{
                fontFamily: theme.fontBody,
                fontSize: "0.78rem",
                lineHeight: 1.5,
                color: theme.textMuted,
                margin: "8px 0 0",
              }}
            >
              Questions about the site itself, or want your organization's
              calendar added?{" "}
              <a
                href={`mailto:${contactEmail}`}
                className="inline-flex items-center"
                style={{
                  gap: 4,
                  fontWeight: 600,
                  color: theme.primaryText,
                  textDecoration: "none",
                }}
              >
                <Mail size={12} />
                {contactEmail}
              </a>
            </p>
          )}

          <h3
            style={{
              fontFamily: theme.fontBody,
              fontSize: "0.75rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: theme.textMuted,
              margin: "20px 0 10px",
            }}
          >
            Privacy
          </h3>

          <p
            style={{
              fontFamily: theme.fontBody,
              fontSize: "0.78rem",
              lineHeight: 1.5,
              color: theme.textMuted,
              margin: 0,
            }}
          >
            This calendar doesn't track you and doesn't use analytics cookies.
            The only cookie it can set is optional: next to the category
            filter pills, a{" "}
            <strong style={{ color: theme.textPrimary }}>Remember my filter</strong>{" "}
            checkbox lets you save which categories you've selected so they're
            the default view the next time you visit. It's off by default —
            nothing is stored unless you check it. If you do, the cookie holds
            only the names of the categories you picked (e.g. "food,
            community"), nothing that identifies you, and it stays on your own
            device for up to a year. Unchecking it, or clearing your browser's
            cookies, removes it.
          </p>
        </div>
      </div>
    </div>
  );
}
