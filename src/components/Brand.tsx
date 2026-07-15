import {
  BRAND_LIME,
  BRAND_LOCKUP_MARK_PATH,
  BRAND_LOCKUP_VIEWBOX,
  BRAND_LOCKUP_WORDMARK_PATH,
  BRAND_MARK_PATH,
  BRAND_MARK_VIEWBOX,
} from "@/lib/brand";

/**
 * The VARIBLE logo, inline. Two presentations, one geometry (see @/lib/brand):
 *
 *   <BrandLockup /> — mark + wordmark. The site identity (nav, footer).
 *   <BrandMark />   — the "V" alone. Compact slots where the wordmark won't fit.
 *
 * Both are decorative by default (`aria-hidden`) — they're always inside a link
 * or heading that already carries the accessible name, and a duplicate label
 * there just makes screen readers say "VARIBLE VARIBLE". Pass an explicit
 * `title` for the rare standalone use.
 *
 * Size by HEIGHT (`className="h-5 w-auto"`); the viewBoxes are cropped to the
 * ink, so width follows the aspect ratio.
 */
function svgProps(title: string | undefined) {
  return title ? { role: "img" as const } : { "aria-hidden": true as const };
}

export function BrandLockup({
  className,
  /** Mark color. Defaults to the brand lime; the wordmark uses currentColor. */
  markColor = BRAND_LIME,
  title,
}: {
  className?: string;
  markColor?: string;
  title?: string;
}) {
  return (
    <svg viewBox={BRAND_LOCKUP_VIEWBOX} fill="none" className={className} {...svgProps(title)}>
      {title ? <title>{title}</title> : null}
      <path d={BRAND_LOCKUP_MARK_PATH} fill={markColor} />
      <path d={BRAND_LOCKUP_WORDMARK_PATH} fill="currentColor" />
    </svg>
  );
}

export function BrandMark({
  className,
  /** Defaults to the brand lime; pass "currentColor" to inherit. */
  color = BRAND_LIME,
  title,
}: {
  className?: string;
  color?: string;
  title?: string;
}) {
  return (
    <svg viewBox={BRAND_MARK_VIEWBOX} fill="none" className={className} {...svgProps(title)}>
      {title ? <title>{title}</title> : null}
      <path d={BRAND_MARK_PATH} fill={color} />
    </svg>
  );
}
