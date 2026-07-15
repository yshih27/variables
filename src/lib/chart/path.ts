/**
 * Shared SVG path builders for charts. Extracted from CategoryTrendChart +
 * IPActivityChart, which each carried a byte-for-byte copy of `monotonePath`, and
 * reused by the Index Studio chart.
 */

/**
 * Monotone cubic (Fritsch–Carlson) path through the points — a smooth curve that
 * never overshoots between samples, so a weekly financial series doesn't grow a
 * false peak/dip between two real points. Straight fallback for <3 points.
 *
 * Points are pre-projected [x, y] in SVG space; callers collect only the FINITE
 * points (skipping NaN gaps), so the curve bridges a sparse series' gaps by
 * connecting its real points rather than cratering to zero.
 */
export function monotonePath(pts: Array<[number, number]>): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  if (n === 2) return `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)} L${pts[1][0].toFixed(1)} ${pts[1][1].toFixed(1)}`;

  const dx: number[] = [];
  const m: number[] = []; // secant slopes
  for (let i = 0; i < n - 1; i++) {
    const hx = pts[i + 1][0] - pts[i][0];
    dx.push(hx);
    m.push(hx !== 0 ? (pts[i + 1][1] - pts[i][1]) / hx : 0);
  }
  const t = new Array<number>(n); // tangents
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) {
      t[i] = 0; // local extremum → flat tangent (prevents overshoot)
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      t[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]); // weighted harmonic mean
    }
  }
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const hx = dx[i];
    const c1x = pts[i][0] + hx / 3;
    const c1y = pts[i][1] + (t[i] * hx) / 3;
    const c2x = pts[i + 1][0] - hx / 3;
    const c2y = pts[i + 1][1] - (t[i + 1] * hx) / 3;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${pts[i + 1][0].toFixed(1)} ${pts[i + 1][1].toFixed(1)}`;
  }
  return d;
}
