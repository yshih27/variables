/**
 * The X (formerly Twitter) brand mark — a monochrome logo glyph that inherits
 * `currentColor`. Shared so the report "Follow on X" CTA and the footer utility
 * nav render the identical mark. Defaults to 13×13; pass `className` to restyle.
 */
export function XGlyph({ className }: { className?: string }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
