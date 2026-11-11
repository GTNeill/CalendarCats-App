/**
 * Renders a category icon, which may be either an emoji/text glyph (the
 * original format) or a URL/path to an uploaded image (see the icon upload
 * in /admincat). Uploaded icons are already scaled server-side-safe at upload
 * time; here we just constrain the rendered box so they line up with emoji.
 */

export function isImageIcon(icon: string | undefined): boolean {
  if (!icon) return false;
  return /^(https?:\/\/|\/|data:image\/)/.test(icon.trim());
}

export default function CategoryIcon({
  icon,
  size = 20,
  alt = "",
}: {
  icon: string | undefined;
  size?: number;
  alt?: string;
}) {
  if (!icon) return null;

  if (isImageIcon(icon)) {
    return (
      <img
        src={icon}
        alt={alt}
        // Decorative when no alt is supplied — the adjacent label carries the meaning.
        aria-hidden={alt ? undefined : true}
        style={{
          width: size,
          height: size,
          objectFit: "contain",
          display: "inline-block",
          verticalAlign: "middle",
          flexShrink: 0,
        }}
      />
    );
  }

  return <span style={{ fontSize: Math.max(12, Math.round(size * 0.9)), lineHeight: 1 }}>{icon}</span>;
}
