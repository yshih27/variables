/**
 * Per-grade colors for the grade-dominance chart.
 *
 * Coloring by grader alone (PSA → one red) makes PSA 10/9/8/7 an indistinct
 * block. Instead each grader family gets a hue RAMP — vivid at grade 10, darker
 * as the grade drops — so grades read as distinct shades while the family stays
 * recognisable (PSA = reds, CGC = blues, BGS = golds, …). Index 0 = grade 10.
 */
const GRADE_RAMPS: Record<string, string[]> = {
  PSA: ["#f04545", "#d23030", "#b02525", "#8a1c1c", "#641414"],
  CGC: ["#5fa3ff", "#4385e6", "#2f68c2", "#214d94", "#163766"],
  BGS: ["#f5c451", "#e0a52f", "#c0851d", "#976515", "#6e490e"],
  SGC: ["#b69bff", "#9678ec", "#7857ce", "#5d41a3", "#432e78"],
  AGS: ["#6cf48a", "#43cd66", "#2da64b", "#1f7d39", "#155a29"],
  TAG: ["#e87cc8", "#d255ad", "#b03d8f", "#882e6f", "#642052"],
};
const DEFAULT_RAMP = ["#9aa6ff", "#7e8ae0", "#6470c2", "#4c5694", "#373f66"];

/** Color for a grade bucket. `grader` picks the hue family; the numeric grade
 *  parsed from `label` (e.g. "PSA 10") picks the shade. Unknown / numberless
 *  grades fall back to the family's brightest shade. */
export function gradeColor(grader: string | null | undefined, label: string): string {
  const ramp = (grader && GRADE_RAMPS[grader.toUpperCase()]) || DEFAULT_RAMP;
  const m = label.match(/(\d+(?:\.\d+)?)/);
  if (!m) return ramp[0];
  const num = parseFloat(m[1]);
  const idx = Math.max(0, Math.min(ramp.length - 1, Math.round(10 - num)));
  return ramp[idx];
}
