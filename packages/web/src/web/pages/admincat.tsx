import { useState, useEffect, useRef, useCallback } from "react";
import { flushSync } from "react-dom";
import { useTheme } from "../lib/theme";
import { authClient, getToken } from "../lib/auth";
import CategoryIcon, { isImageIcon } from "../components/CategoryIcon";

/**
 * fetch() for admin endpoints. Sessions normally ride on the Better Auth
 * cookie, but a stored bearer token is also honoured when present.
 */
function adminFetch(input: string, init: RequestInit = {}) {
  const token = getToken();
  const headers = new Headers(init.headers ?? {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers, credentials: "include" });
}

interface Category {
  /**
   * Stable client-only row identity. The `key` field is user-editable, so it
   * cannot be used as the React key — it changes on every keystroke, which
   * remounts the row and drops focus after a single character. Never sent to
   * the server.
   */
  uid: string;
  key: string;
  label: string;
  icon: string;
  color: string;
  group: string;
  order: number;
  keywords: string[];
}

/** Category as stored/returned by the API — no client-only uid. */
type StoredCategory = Omit<Category, "uid">;

let uidCounter = 0;
function newUid() { return `row_${Date.now().toString(36)}_${++uidCounter}`; }
function withUid(c: StoredCategory): Category { return { ...c, uid: newUid() }; }
function stripUid(c: Category): StoredCategory {
  const { uid: _uid, ...rest } = c;
  return rest;
}

/**
 * Warns before a refresh/tab-close/navigation while there are unsaved edits.
 * Browsers show their own generic confirmation dialog for this.
 */
function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
}

/** Confirm before following an in-app link that would discard unsaved edits. */
function confirmDiscard(dirty: boolean) {
  return !dirty || window.confirm("You have unsaved changes. Leave this page and discard them?");
}

const GROUP_OPTIONS = [
  { value: "government", label: "Your Government" },
  { value: "community", label: "Your Community" },
];

// ── Keyword chip editor ───────────────────────────────────────────────────────
function KeywordEditor({
  keywords,
  onChange,
  disabled,
  theme,
}: {
  keywords: string[];
  onChange: (kw: string[]) => void;
  disabled?: boolean;
  theme: ReturnType<typeof useTheme>["theme"];
}) {
  const [input, setInput] = useState("");

  const addKeyword = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed || keywords.includes(trimmed)) return;
    // flushSync forces this state update through synchronously (not batched)
    // so a Save click that follows immediately after (e.g. clicking Save
    // while text is still typed but not yet committed via Enter) always
    // reads the up-to-date keyword list instead of a stale pre-blur render.
    flushSync(() => {
      onChange([...keywords, trimmed]);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const val = input.replace(/,$/, "").trim();
      if (val) addKeyword(val);
      setInput("");
    } else if (e.key === "Backspace" && !input && keywords.length > 0) {
      onChange(keywords.slice(0, -1));
    }
  };

  return (
    <div style={{
      display: "flex",
      flexWrap: "wrap",
      gap: "4px",
      padding: "6px 8px",
      border: `1px solid ${theme.border}`,
      borderRadius: "6px",
      background: theme.surface,
      minHeight: "38px",
      alignItems: "center",
    }}>
      {keywords.map((kw, i) => (
        <span key={i} style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: "2px 8px",
          background: `${theme.primary}22`,
          border: `1px solid ${theme.primary}66`,
          borderRadius: "12px",
          fontSize: "11px",
          color: theme.textPrimary,
          fontFamily: "monospace",
        }}>
          {kw}
          {!disabled && (
            <button
              onClick={() => onChange(keywords.filter((_, j) => j !== i))}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: theme.textMuted,
                padding: "0 0 0 2px",
                fontSize: "12px",
                lineHeight: 1,
              }}
            >×</button>
          )}
        </span>
      ))}
      {!disabled && (
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            const val = input.trim();
            if (val) { addKeyword(val); setInput(""); }
          }}
          placeholder={keywords.length === 0 ? "type keyword, Enter to add…" : ""}
          style={{
            flex: "1 1 120px",
            border: "none",
            outline: "none",
            background: "transparent",
            color: theme.textPrimary,
            fontSize: "12px",
            minWidth: "80px",
          }}
        />
      )}
    </div>
  );
}

// ── Icon field — emoji text input + image upload (scaled client-side) ─────────
const ICON_PX = 128; // uploaded icons are scaled to fit this box before upload

function IconField({
  icon,
  catKey,
  disabled,
  onChange,
  theme,
  inputStyle,
}: {
  icon: string;
  catKey: string;
  disabled?: boolean;
  onChange: (icon: string) => void;
  theme: ReturnType<typeof useTheme>["theme"];
  inputStyle: React.CSSProperties;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isImage = isImageIcon(icon);

  /** Scale the chosen image to fit ICON_PX x ICON_PX (aspect preserved, transparent padding). */
  const scaleToDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read file"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Not a valid image"));
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = ICON_PX;
          canvas.height = ICON_PX;
          const ctx = canvas.getContext("2d");
          if (!ctx) return reject(new Error("Canvas unavailable"));
          const ratio = Math.min(ICON_PX / img.width, ICON_PX / img.height);
          const w = Math.round(img.width * ratio);
          const h = Math.round(img.height * ratio);
          ctx.drawImage(img, Math.round((ICON_PX - w) / 2), Math.round((ICON_PX - h) / 2), w, h);
          resolve(canvas.toDataURL("image/png"));
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setErr(null);
    setBusy(true);
    try {
      const dataUrl = await scaleToDataUrl(file);
      const res = await adminFetch("/api/admin/icons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, key: catKey }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Upload failed (${res.status})`);
      onChange(json.url);
    } catch (e: any) {
      setErr(e.message ?? "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {isImage ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "36px",
            border: `1px solid ${theme.border}`,
            borderRadius: "6px",
            background: theme.surface,
          }}
          title={icon}
        >
          <img src={icon} alt="" style={{ width: 22, height: 22, objectFit: "contain" }} />
        </div>
      ) : (
        <input
          value={icon}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          placeholder="🏛️"
          title="Paste an emoji, or upload an image below"
          style={{ ...inputStyle, fontSize: "20px", textAlign: "center", padding: "4px" }}
        />
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
        onChange={e => handleFile(e.target.files?.[0])}
        style={{ display: "none" }}
      />

      <div style={{ display: "flex", gap: "3px" }}>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={disabled || busy}
          title="Upload an image to use as this category's icon (scaled automatically)"
          style={{
            flex: 1,
            padding: "3px 4px",
            fontSize: "9px",
            border: `1px solid ${theme.border}`,
            borderRadius: "4px",
            background: "transparent",
            color: theme.textMuted,
            cursor: disabled || busy ? "not-allowed" : "pointer",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {busy ? "…" : isImage ? "Replace" : "Upload"}
        </button>
        {isImage && (
          <button
            onClick={() => onChange("")}
            disabled={disabled}
            title="Remove the image and go back to an emoji icon"
            style={{
              padding: "3px 5px",
              fontSize: "9px",
              border: `1px solid ${theme.border}`,
              borderRadius: "4px",
              background: "transparent",
              color: "#e05555",
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            ✕
          </button>
        )}
      </div>

      {err && <span style={{ fontSize: "9px", color: "#e05555" }}>{err}</span>}
    </div>
  );
}

// ── Single category row ───────────────────────────────────────────────────────
function CategoryRow({
  cat,
  idx,
  total,
  onChange,
  onDelete,
  onMove,
  theme,
}: {
  cat: Category;
  idx: number;
  total: number;
  onChange: (c: Category) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  theme: ReturnType<typeof useTheme>["theme"];
}) {
  const isOther = cat.key === "other";

  const arrowBtn: React.CSSProperties = {
    padding: "2px 4px",
    background: "transparent",
    border: `1px solid ${theme.border}`,
    borderRadius: "4px",
    color: theme.textMuted,
    cursor: "pointer",
    fontSize: "10px",
    lineHeight: 1,
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "10px",
    color: theme.textMuted,
    marginBottom: "3px",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "6px 8px",
    border: `1px solid ${theme.border}`,
    borderRadius: "6px",
    background: theme.surface,
    color: theme.textPrimary,
    fontSize: "13px",
    boxSizing: "border-box",
  };

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "28px 80px 48px 60px 1fr 100px 120px 1fr 80px",
      gap: "8px",
      alignItems: "start",
      padding: "12px",
      background: theme.surface,
      border: `1px solid ${theme.border}`,
      borderRadius: "8px",
      borderLeft: `4px solid ${cat.color}`,
    }}>
      {/* Order controls */}
      <div style={{ display: "flex", flexDirection: "column", gap: "2px", alignItems: "center" }}>
        <button onClick={() => onMove(-1)} disabled={idx === 0 || isOther} title="Move up" style={arrowBtn}>▲</button>
        <button onClick={() => onMove(1)} disabled={idx >= total - (isOther ? 1 : 2) || isOther} title="Move down" style={arrowBtn}>▼</button>
      </div>

      {/* Key */}
      <div>
        <label style={labelStyle}>Key</label>
        <input
          value={cat.key}
          onChange={e => onChange({ ...cat, key: e.target.value })}
          disabled={isOther}
          title={isOther ? 'The "other" fallback key cannot be renamed' : "Category key — lowercase identifier, must be unique"}
          style={{
            ...inputStyle,
            fontFamily: "monospace",
            fontSize: "11px",
            opacity: isOther ? 0.5 : 1,
          }}
        />
      </div>

      {/* Icon — emoji text or an uploaded image */}
      <div>
        <label style={labelStyle}>Icon</label>
        <IconField
          icon={cat.icon}
          catKey={cat.key}
          disabled={isOther}
          onChange={icon => onChange({ ...cat, icon })}
          theme={theme}
          inputStyle={inputStyle}
        />
      </div>

      {/* Color swatch */}
      <div>
        <label style={labelStyle}>Color</label>
        <input
          type="color"
          value={cat.color}
          onChange={e => onChange({ ...cat, color: e.target.value })}
          disabled={isOther}
          style={{
            width: "100%",
            height: "36px",
            padding: "2px",
            border: `1px solid ${theme.border}`,
            borderRadius: "6px",
            background: theme.surface,
            cursor: isOther ? "not-allowed" : "pointer",
          }}
        />
      </div>

      {/* Label */}
      <div>
        <label style={labelStyle}>Label</label>
        <input
          value={cat.label}
          onChange={e => onChange({ ...cat, label: e.target.value })}
          style={inputStyle}
        />
      </div>

      {/* Hex */}
      <div>
        <label style={labelStyle}>Hex</label>
        <input
          value={cat.color}
          onChange={e => onChange({ ...cat, color: e.target.value })}
          disabled={isOther}
          style={{ ...inputStyle, fontFamily: "monospace", fontSize: "12px" }}
        />
      </div>

      {/* Group */}
      <div>
        <label style={labelStyle}>Group</label>
        <select
          value={cat.group}
          onChange={e => onChange({ ...cat, group: e.target.value })}
          style={{ ...inputStyle }}
        >
          {GROUP_OPTIONS.map(g => (
            <option key={g.value} value={g.value}>{g.label}</option>
          ))}
        </select>
      </div>

      {/* Keywords */}
      <div>
        <label style={labelStyle}>Keywords (Enter or , to add)</label>
        <KeywordEditor
          keywords={cat.keywords}
          onChange={kw => onChange({ ...cat, keywords: kw })}
          disabled={isOther}
          theme={theme}
        />
      </div>

      {/* Delete */}
      <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: "2px" }}>
        <button
          onClick={onDelete}
          disabled={isOther}
          title="Delete category"
          style={{
            padding: "6px 10px",
            background: "rgba(200,50,50,0.15)",
            border: "1px solid rgba(200,50,50,0.4)",
            borderRadius: "6px",
            color: "#e05555",
            cursor: isOther ? "not-allowed" : "pointer",
            opacity: isOther ? 0.3 : 1,
            fontSize: "14px",
          }}
        >🗑</button>
      </div>
    </div>
  );
}

// ── Site Settings panel ────────────────────────────────────────────────────────
interface SiteSettings {
  headerTitle: string;
  headerSubtitle: string;
  footerText: string;
  footerLinkText: string;
  footerLinkUrl: string;
  submitEventUrl: string;
  contactEmail: string;
}

const SETTINGS_FIELD_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--border, #2A2A2A)",
  borderRadius: "6px",
  fontSize: "13px",
  boxSizing: "border-box",
};

function SiteSettingsPanel({ theme }: { theme: ReturnType<typeof useTheme>["theme"] }) {
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useUnsavedGuard(dirty);

  useEffect(() => {
    adminFetch("/api/settings")
      .then(r => r.json())
      .then((data: SiteSettings) => setSettings(data))
      .catch(e => setStatus({ msg: `Failed to load settings: ${e.message}`, ok: false }));
  }, []);

  const showStatus = (msg: string, ok: boolean) => {
    setStatus({ msg, ok });
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), 4000);
  };

  const field = (key: keyof SiteSettings) => (
    <input
      id={`setting-${key}`}
      value={settings?.[key] ?? ""}
      onChange={e => {
        setSettings(s => (s ? { ...s, [key]: e.target.value } : s));
        setDirty(true);
      }}
      style={{
        ...SETTINGS_FIELD_STYLE,
        background: theme.surface,
        color: theme.textPrimary,
        borderColor: theme.border,
      }}
    />
  );

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await adminFetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      showStatus("Site settings saved.", true);
      setDirty(false);
    } catch (e: any) {
      showStatus(e.message, false);
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return (
      <div style={{ padding: "16px 0", color: theme.textMuted, fontSize: "13px" }}>
        Loading site settings…
      </div>
    );
  }

  return (
    <div style={{
      background: theme.surface,
      border: `1px solid ${theme.border}`,
      borderRadius: "10px",
      padding: "18px 20px",
      marginBottom: "8px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
        <h2 style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: theme.textPrimary }}>
          Site Settings
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {status && (
            <span style={{
              fontSize: "12px",
              color: status.ok ? "#4caf8a" : "#e05555",
              background: status.ok ? "rgba(76,175,138,0.1)" : "rgba(224,85,85,0.1)",
              border: `1px solid ${status.ok ? "rgba(76,175,138,0.3)" : "rgba(224,85,85,0.3)"}`,
              borderRadius: "6px",
              padding: "4px 10px",
            }}>{status.msg}</span>
          )}
          <button
            onClick={save}
            disabled={saving || !dirty}
            style={{
              padding: "7px 16px",
              background: dirty ? theme.primary : `${theme.primary}33`,
              border: `1px solid ${theme.primary}`,
              borderRadius: "6px",
              color: dirty ? "#fff" : `${theme.textPrimary}66`,
              cursor: dirty ? "pointer" : "not-allowed",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >{saving ? "Saving…" : "Save Settings"}</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
        <div>
          <label style={{ display: "block", fontSize: "11px", color: theme.textMuted, marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Page Header
          </label>
          {field("headerTitle")}
        </div>
        <div>
          <label style={{ display: "block", fontSize: "11px", color: theme.textMuted, marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Subtitle
          </label>
          {field("headerSubtitle")}
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="setting-footerText" style={{ display: "block", fontSize: "11px", color: theme.textMuted, marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Footer Text <span style={{ opacity: 0.7 }}>(left side, leave blank to hide)</span>
          </label>
          {field("footerText")}
        </div>
        <div>
          <label style={{ display: "block", fontSize: "11px", color: theme.textMuted, marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Footer Link Text
          </label>
          {field("footerLinkText")}
        </div>
        <div>
          <label style={{ display: "block", fontSize: "11px", color: theme.textMuted, marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Footer Link URL <span style={{ opacity: 0.7 }}>(leave blank to hide the link)</span>
          </label>
          {field("footerLinkUrl")}
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="setting-submitEventUrl" style={{ display: "block", fontSize: "11px", color: theme.textMuted, marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Submit Your Event URL <span style={{ opacity: 0.7 }}>(leave blank to hide the button)</span>
          </label>
          {field("submitEventUrl")}
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="setting-contactEmail" style={{ display: "block", fontSize: "11px", color: theme.textMuted, marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Contact Email <span style={{ opacity: 0.7 }}>(shown in the About popup, leave blank to hide it)</span>
          </label>
          {field("contactEmail")}
        </div>
      </div>
    </div>
  );
}

// ── Calendar Feed Sources panel ───────────────────────────────────────────────
// Parity with the WordPress plugin's Settings -> CalendarCats feeds box. The
// line format is identical on purpose, so a feed list can be pasted between
// the plugin and the site without editing.
interface FeedSettings {
  ics: string;
  squarespace: string;
  rss: string;
}

interface ResolvedFeeds {
  ics: { url: string; name: string; gcalId: string; pageUrl: string }[];
  squarespace: { url: string; name: string; pageUrl: string }[];
  rss: { url: string; name: string; pageUrl: string }[];
}

const AREA_LABELS: Record<keyof FeedSettings, string> = {
  ics: "Calendar feeds, one per line",
  squarespace: "Squarespace sources, one per line",
  rss: "Events RSS feeds, one per line",
};

function FeedSourcesPanel({ theme }: { theme: ReturnType<typeof useTheme>["theme"] }) {
  const [feeds, setFeeds] = useState<FeedSettings | null>(null);
  const [resolved, setResolved] = useState<ResolvedFeeds | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useUnsavedGuard(dirty);

  useEffect(() => {
    adminFetch("/api/admin/feeds")
      .then(r => r.json())
      .then((data: { feeds: FeedSettings; resolved: ResolvedFeeds }) => {
        setFeeds(data.feeds);
        setResolved(data.resolved);
      })
      .catch(e => setStatus({ msg: `Failed to load feeds: ${e.message}`, ok: false }));
  }, []);

  const showStatus = (msg: string, ok: boolean) => {
    setStatus({ msg, ok });
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), 6000);
  };

  const save = async () => {
    if (!feeds) return;
    setSaving(true);
    try {
      const res = await adminFetch("/api/admin/feeds", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(feeds),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setResolved(data.resolved);
      showStatus("Calendar sources saved.", true);
      setDirty(false);
    } catch (e: any) {
      showStatus(e.message, false);
    } finally {
      setSaving(false);
    }
  };

  const area = (key: keyof FeedSettings) => (
    <textarea
      id={`feeds-${key}`}
      aria-label={AREA_LABELS[key]}
      value={feeds?.[key] ?? ""}
      rows={key === "ics" ? 5 : 3}
      spellCheck={false}
      onChange={e => {
        setFeeds(f => (f ? { ...f, [key]: e.target.value } : f));
        setDirty(true);
      }}
      style={{
        ...SETTINGS_FIELD_STYLE,
        background: theme.surface,
        color: theme.textPrimary,
        borderColor: theme.border,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: "12px",
        lineHeight: 1.6,
        resize: "vertical",
      }}
    />
  );

  if (!feeds) {
    return (
      <div style={{ padding: "16px 0", color: theme.textMuted, fontSize: "13px" }}>
        Loading calendar sources…
      </div>
    );
  }

  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: "11px", color: theme.textMuted, marginBottom: "4px",
    textTransform: "uppercase", letterSpacing: "0.04em",
  };
  const hintStyle: React.CSSProperties = {
    fontSize: "11px", color: theme.textMuted, opacity: 0.85, marginTop: "5px", lineHeight: 1.5,
  };

  return (
    <div style={{
      background: theme.surface,
      border: `1px solid ${theme.border}`,
      borderRadius: "10px",
      padding: "18px 20px",
      marginBottom: "8px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
        <h2 style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: theme.textPrimary }}>
          Calendar Sources
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {status && (
            <span style={{
              fontSize: "12px",
              color: status.ok ? "#4caf8a" : "#e05555",
              background: status.ok ? "rgba(76,175,138,0.1)" : "rgba(224,85,85,0.1)",
              border: `1px solid ${status.ok ? "rgba(76,175,138,0.3)" : "rgba(224,85,85,0.3)"}`,
              borderRadius: "6px",
              padding: "4px 10px",
              maxWidth: "460px",
            }}>{status.msg}</span>
          )}
          <button
            onClick={save}
            disabled={saving || !dirty}
            style={{
              padding: "7px 16px",
              background: dirty ? theme.primary : `${theme.primary}33`,
              border: `1px solid ${theme.primary}`,
              borderRadius: "6px",
              color: dirty ? "#fff" : `${theme.textPrimary}66`,
              cursor: dirty ? "pointer" : "not-allowed",
              fontSize: "12px",
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >{saving ? "Saving…" : "Save Sources"}</button>
        </div>
      </div>

      <div style={{ display: "grid", gap: "16px" }}>
        <div>
          <label htmlFor="feeds-ics" style={labelStyle}>
            Calendar Feeds <span style={{ opacity: 0.7 }}>(one per line)</span>
          </label>
          {area("ics")}
          <div style={hintStyle}>
            Each line is a full <code>.ics</code> URL or a bare Google Calendar id, with an
            optional display name after a pipe. Lines starting with <code>#</code> are ignored.
            Order matters: when two calendars list the same event, the one higher in this list wins.
            <br />
            <code>abc123@group.calendar.google.com | Ward Events</code>
            <br />
            <code>https://example.org/events.ics | Chamber Events</code>
            <br />
            A calendar feed has no public page of its own — add a third field with the URL of the
            website page that presents it (even just as an embedded iframe), so the About popup
            can link there instead of to raw calendar data. Left off, that source gets no link.
            <br />
            <code>abc123@group.calendar.google.com | Ward Events | https://example.org/events/</code>
          </div>
        </div>

        <div>
          <label htmlFor="feeds-squarespace" style={labelStyle}>
            Squarespace Sources <span style={{ opacity: 0.7 }}>(one per line, optional)</span>
          </label>
          {area("squarespace")}
          <div style={hintStyle}>
            For neighborhood orgs on Squarespace, which publish no usable <code>.ics</code>.
            Use the full URL of their events page. These are supplemental — if one is down or
            changes shape, it is skipped and the calendars above still render.
            <br />
            <code>https://www.example.org/events | Example Org</code>
            <br />
            This URL is already the page presenting the calendar, so the About popup links to it
            automatically — add a third field only if a different page should be linked instead.
          </div>
        </div>

        <div>
          <label htmlFor="feeds-rss" style={labelStyle}>
            Events RSS Feeds <span style={{ opacity: 0.7 }}>(one per line, optional)</span>
          </label>
          {area("rss")}
          <div style={hintStyle}>
            For orgs on Wild Apricot and similar platforms, which publish no export at all.
            Use the full URL of their events RSS feed — on Wild Apricot that is the events page
            with <code>/rss</code> on the end. These carry a start time only: the feed has no end
            time or location, so those are left blank rather than guessed.
            <br />
            <code>https://www.example.org/events/rss | Example Org</code>
            <br />
            The feed URL is rarely the page itself — add a third field with the actual events page
            so the About popup links there instead of the raw feed.
            <br />
            <code>https://www.example.org/events/rss | Example Org | https://www.example.org/events</code>
          </div>
        </div>

        {resolved && (
          <div style={{
            borderTop: `1px solid ${theme.border}`,
            paddingTop: "12px",
            fontSize: "11px",
            color: theme.textMuted,
          }}>
            <div style={{ ...labelStyle, marginBottom: "6px" }}>
              Currently reading ({resolved.ics.length + resolved.squarespace.length + resolved.rss.length})
            </div>
            {resolved.ics.length + resolved.squarespace.length + resolved.rss.length === 0 && (
              <div style={{ opacity: 0.8 }}>No readable sources.</div>
            )}
            {resolved.ics.map((f, i) => (
              <div key={`ics-${f.url}`} style={{ display: "flex", gap: "8px", marginBottom: "3px" }}>
                <span style={{ opacity: 0.6, minWidth: "14px" }}>{i + 1}.</span>
                <span style={{ color: theme.textPrimary, minWidth: "170px" }}>{f.name}</span>
                <span style={{ opacity: 0.75, wordBreak: "break-all" }}>
                  {f.url}
                  {f.pageUrl
                    ? <> — page: <span style={{ color: theme.primaryText }}>{f.pageUrl}</span></>
                    : <em style={{ color: "#e05555" }}> — no page link set, About popup won't link this source</em>}
                </span>
              </div>
            ))}
            {resolved.squarespace.map((f, i) => (
              <div key={`sqsp-${f.url}`} style={{ display: "flex", gap: "8px", marginBottom: "3px" }}>
                <span style={{ opacity: 0.6, minWidth: "14px" }}>{resolved.ics.length + i + 1}.</span>
                <span style={{ color: theme.textPrimary, minWidth: "170px" }}>{f.name}</span>
                <span style={{ opacity: 0.75, wordBreak: "break-all" }}>
                  {f.url} <em>(Squarespace)</em>
                  {f.pageUrl !== f.url && <> — page: <span style={{ color: theme.primaryText }}>{f.pageUrl}</span></>}
                </span>
              </div>
            ))}
            {resolved.rss.map((f, i) => (
              <div key={`rss-${f.url}`} style={{ display: "flex", gap: "8px", marginBottom: "3px" }}>
                <span style={{ opacity: 0.6, minWidth: "14px" }}>
                  {resolved.ics.length + resolved.squarespace.length + i + 1}.
                </span>
                <span style={{ color: theme.textPrimary, minWidth: "170px" }}>{f.name}</span>
                <span style={{ opacity: 0.75, wordBreak: "break-all" }}>
                  {f.url} <em>(RSS)</em>
                  {f.pageUrl
                    ? <> — page: <span style={{ color: theme.primaryText }}>{f.pageUrl}</span></>
                    : <em style={{ color: "#e05555" }}> — no page link set, links to the site's home page instead</em>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
let newKeyCounter = 0;
function newKey() { return `__new_${++newKeyCounter}`; }

function AdminCatInner() {
  const { theme } = useTheme();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null);
  const [dirty, setDirty] = useState(false);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useUnsavedGuard(dirty);

  useEffect(() => {
    adminFetch("/api/admin/categories")
      .then(r => r.json())
      .then((data: StoredCategory[]) => {
        setCategories(data.sort((a, b) => a.order - b.order).map(withUid));
        setLoading(false);
      })
      .catch(e => {
        setStatus({ msg: `Failed to load: ${e.message}`, ok: false });
        setLoading(false);
      });
  }, []);

  const showStatus = (msg: string, ok: boolean) => {
    setStatus({ msg, ok });
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), 4000);
  };

  // Rows render from `displayList`, which pins "other" to the end, so a
  // positional index into `categories` can point at the wrong row. Address
  // rows by their stable uid instead.
  const update = useCallback((uid: string, cat: Category) => {
    setCategories(prev => prev.map(c => c.uid === uid ? cat : c));
    setDirty(true);
  }, []);

  const remove = useCallback((uid: string) => {
    setCategories(prev => prev.filter(c => c.uid !== uid));
    setDirty(true);
  }, []);

  const move = useCallback((uid: string, dir: -1 | 1) => {
    setCategories(prev => {
      const from = prev.findIndex(c => c.uid === uid);
      const to = from + dir;
      if (from === -1 || to < 0 || to >= prev.length) return prev;
      // Never reorder across the "other" fallback, which always sorts last.
      if (prev[to].key === "other") return prev;
      const next = [...prev];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
    setDirty(true);
  }, []);

  const addNew = () => {
    const newCat: Category = {
      uid: newUid(),
      key: newKey(),
      label: "New Category",
      icon: "📁",
      color: "#888888",
      group: "community",
      order: categories.length,
      keywords: [],
    };
    setCategories(prev => {
      const withoutOther = prev.filter(c => c.key !== "other");
      const other = prev.find(c => c.key === "other");
      return other ? [...withoutOther, newCat, other] : [...withoutOther, newCat];
    });
    setDirty(true);
  };

  const save = async () => {
    // Force-commit any text still sitting in a focused keyword input (e.g.
    // typed but not confirmed with Enter/comma) before reading `categories`.
    // Blurring here synchronously triggers that input's onBlur → addKeyword,
    // which now uses flushSync, so the state is guaranteed current below.
    (document.activeElement as HTMLElement | null)?.blur();

    setSaving(true);
    try {
      // Keys are editable, so normalise whatever was typed: lowercase, and
      // anything that isn't a-z/0-9 collapses to an underscore.
      const normaliseKey = (c: Category) =>
        (c.key.startsWith("__new") ? c.label : c.key)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "");

      const keys = categories.map(normaliseKey);

      if (keys.some(k => !k)) {
        showStatus("Every category needs a key — fix before saving.", false);
        setSaving(false);
        return;
      }

      const hasDupe = keys.some((k, i) => keys.indexOf(k) !== i);
      if (hasDupe) {
        showStatus("Duplicate category keys — fix before saving.", false);
        setSaving(false);
        return;
      }

      const payload = categories.map((c, i) => ({
        ...stripUid(c),
        key: normaliseKey(c),
        order: i,
      }));

      const res = await adminFetch("/api/admin/categories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      showStatus(`Saved ${data.count} categories.`, true);
      setDirty(false);

      const fresh = await adminFetch("/api/admin/categories").then(r => r.json());
      setCategories((fresh as StoredCategory[]).sort((a, b) => a.order - b.order).map(withUid));
    } catch (e: any) {
      showStatus(e.message, false);
    } finally {
      setSaving(false);
    }
  };

  const nonOther = categories.filter(c => c.key !== "other");
  const other = categories.find(c => c.key === "other");
  const displayList = other ? [...nonOther, other] : categories;

  return (
    <div style={{
      minHeight: "100vh",
      background: theme.bg,
      color: theme.textPrimary,
      fontFamily: theme.fontBody,
    }}>
      {/* Header */}
      <div style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        background: theme.bgHeader,
        borderBottom: `1px solid ${theme.border}`,
        padding: "16px 32px",
        display: "flex",
        alignItems: "center",
        gap: "16px",
        justifyContent: "space-between",
        backdropFilter: "blur(8px)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <a
            href="/"
            onClick={e => { if (!confirmDiscard(dirty)) e.preventDefault(); }}
            style={{
              color: theme.textMuted,
              textDecoration: "none",
              fontSize: "13px",
              padding: "6px 10px",
              border: `1px solid ${theme.border}`,
              borderRadius: "6px",
            }}
          >← Calendar</a>
          <h1 style={{ margin: 0, fontSize: "18px", fontWeight: 600, color: theme.textPrimary }}>
            Category Manager
          </h1>
          {dirty && (
            <span style={{
              fontSize: "11px",
              color: theme.accent,
              background: `${theme.accent}18`,
              border: `1px solid ${theme.accent}44`,
              borderRadius: "4px",
              padding: "2px 8px",
            }}>unsaved changes</span>
          )}
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {status && (
            <span style={{
              fontSize: "13px",
              color: status.ok ? "#4caf8a" : "#e05555",
              background: status.ok ? "rgba(76,175,138,0.1)" : "rgba(224,85,85,0.1)",
              border: `1px solid ${status.ok ? "rgba(76,175,138,0.3)" : "rgba(224,85,85,0.3)"}`,
              borderRadius: "6px",
              padding: "6px 12px",
            }}>{status.msg}</span>
          )}
          <button
            onClick={addNew}
            style={{
              padding: "8px 16px",
              background: `${theme.primary}22`,
              border: `1px solid ${theme.primary}66`,
              borderRadius: "6px",
              color: theme.primary,
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 500,
            }}
          >+ Add Category</button>
          <button
            onClick={save}
            disabled={saving || !dirty}
            style={{
              padding: "8px 20px",
              background: dirty ? theme.accent : `${theme.accent}33`,
              border: `1px solid ${theme.accent}`,
              borderRadius: "6px",
              color: dirty ? "#fff" : `${theme.textPrimary}66`,
              cursor: dirty ? "pointer" : "not-allowed",
              fontSize: "13px",
              fontWeight: 600,
              transition: "all 0.15s",
            }}
          >{saving ? "Saving…" : "Save Changes"}</button>
        </div>
      </div>

      {/* Tip bar */}
      <div style={{
        padding: "10px 32px",
        background: `${theme.primary}11`,
        borderBottom: `1px solid ${theme.border}`,
        fontSize: "12px",
        color: theme.textMuted,
      }}>
        <strong style={{ color: theme.textPrimary }}>Tip:</strong>{" "}
        Keywords match case-insensitively against event titles. Use{" "}
        <code style={{ background: `${theme.textFaint}44`, padding: "1px 4px", borderRadius: "3px" }}>.*</code>{" "}
        for wildcards. <strong>Other</strong> always catches unmatched events — its keywords are ignored.
        Press <kbd style={{ background: `${theme.textFaint}44`, padding: "1px 5px", borderRadius: "3px" }}>Enter</kbd>{" "}
        or <kbd style={{ background: `${theme.textFaint}44`, padding: "1px 5px", borderRadius: "3px" }}>,</kbd> to add a keyword.
      </div>

      {/* Site Settings */}
      <div style={{ padding: "24px 32px 0", maxWidth: "1400px", margin: "0 auto" }}>
        <SiteSettingsPanel theme={theme} />
        <FeedSourcesPanel theme={theme} />
      </div>

      {/* Body */}
      <div style={{ padding: "24px 32px", maxWidth: "1400px", margin: "0 auto" }}>
        {loading ? (
          <div style={{ textAlign: "center", color: theme.textMuted, paddingTop: "60px" }}>
            Loading categories…
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {displayList.map((cat, idx) => (
              <CategoryRow
                key={cat.uid}
                cat={cat}
                idx={idx}
                total={displayList.length}
                onChange={c => update(cat.uid, c)}
                onDelete={() => remove(cat.uid)}
                onMove={dir => move(cat.uid, dir)}
                theme={theme}
              />
            ))}
          </div>
        )}

        {/* Group preview */}
        {!loading && (
          <div style={{ marginTop: "32px", display: "flex", gap: "24px" }}>
            {GROUP_OPTIONS.map(g => {
              const cats = displayList.filter(c => c.group === g.value);
              return (
                <div key={g.value} style={{
                  flex: 1,
                  background: theme.surface,
                  border: `1px solid ${theme.border}`,
                  borderRadius: "8px",
                  padding: "16px",
                }}>
                  <div style={{
                    fontSize: "12px",
                    color: theme.textMuted,
                    marginBottom: "10px",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}>
                    {g.label}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {cats.map(c => (
                      <span key={c.uid} style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "5px",
                        padding: "4px 10px",
                        background: `${c.color}22`,
                        border: `1px solid ${c.color}55`,
                        borderRadius: "20px",
                        fontSize: "12px",
                        color: c.color,
                      }}>
                        <CategoryIcon icon={c.icon} size={13} /> {c.label}
                      </span>
                    ))}
                    {cats.length === 0 && (
                      <span style={{ fontSize: "12px", color: theme.textMuted }}>none assigned</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Auth gate ──────────────────────────────────────────────────────────────
type AuthCheck = { signedIn: boolean; email: string | null; authorized: boolean };

function AdminSignIn({ deniedEmail }: { deniedEmail?: string | null }) {
  const { theme } = useTheme();
  const [busy, setBusy] = useState(false);

  // Better Auth redirects failures to <errorCallbackURL>?error=<code>. Without
  // this the only symptom is a bare ?error=invalid_code on the home page.
  const authError = new URLSearchParams(window.location.search).get("error");

  const signIn = async () => {
    setBusy(true);
    await authClient.signIn.social({
      provider: "google",
      callbackURL: "/admincat",
      errorCallbackURL: "/admincat",
    });
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: theme.bg,
      color: theme.textPrimary,
      fontFamily: theme.fontBody,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
    }}>
      <div style={{
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: "12px",
        padding: "40px",
        maxWidth: "380px",
        width: "100%",
        textAlign: "center",
      }}>
        <h1 style={{
          margin: "0 0 8px",
          fontFamily: theme.fontDisplay,
          fontSize: "24px",
          fontWeight: 700,
          color: theme.textPrimary,
        }}>
          Category Manager
        </h1>
        <p style={{ margin: "0 0 24px", fontSize: "13px", color: theme.textMuted }}>
          Sign in with an authorized Google account to continue.
        </p>

        {deniedEmail && (
          <div style={{
            marginBottom: "20px",
            padding: "10px 14px",
            borderRadius: "6px",
            background: `${theme.accent}18`,
            border: `1px solid ${theme.accent}44`,
            fontSize: "12px",
            color: theme.accent,
          }}>
            {deniedEmail} isn't authorized for this page.
          </div>
        )}

        {authError && (
          <div style={{
            marginBottom: "20px",
            padding: "10px 14px",
            borderRadius: "6px",
            background: `${theme.accent}18`,
            border: `1px solid ${theme.accent}44`,
            fontSize: "12px",
            color: theme.accent,
            textAlign: "left",
          }}>
            <strong>Google sign-in failed: {authError}</strong>
            {authError === "invalid_code" && (
              <div style={{ marginTop: 6, color: theme.textMuted }}>
                Google rejected the sign-in. Open{" "}
                <a href="/api/auth-diagnostics" style={{ color: theme.accent }}>/api/auth-diagnostics</a>{" "}
                to check the credentials and redirect URI.
              </div>
            )}
          </div>
        )}

        <button
          onClick={signIn}
          disabled={busy}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
            width: "100%",
            padding: "11px 16px",
            borderRadius: "8px",
            border: `1px solid ${theme.border}`,
            background: theme.bg,
            color: theme.textPrimary,
            fontSize: "14px",
            fontWeight: 500,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.09-1.8 2.73v2.27h2.92c1.71-1.57 2.68-3.88 2.68-6.64z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.27c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.34C2.44 15.98 5.48 18 9 18z"/>
            <path fill="#FBBC05" d="M3.97 10.7A5.4 5.4 0 0 1 3.68 9c0-.59.1-1.17.29-1.7V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3.01-2.34z"/>
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.59-2.59C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58z"/>
          </svg>
          {busy ? "Redirecting…" : "Sign in with Google"}
        </button>
      </div>
    </div>
  );
}

export default function AdminCat() {
  const [check, setCheck] = useState<AuthCheck | null>(null);

  useEffect(() => {
    adminFetch("/api/admin/whoami")
      .then(r => r.json())
      .then(setCheck)
      .catch(() => setCheck({ signedIn: false, email: null, authorized: false }));
  }, []);

  if (!check) return null;
  if (!check.authorized) return <AdminSignIn deniedEmail={check.signedIn ? check.email : null} />;
  return <AdminCatInner />;
}
