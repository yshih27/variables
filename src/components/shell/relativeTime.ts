/**
 * Honest relative time for the tape.
 *
 * ⚠️ NO FAKE URGENCY, and no rounding that flatters. A 59-second-old event says
 * "just now"; everything else says the largest whole unit that is TRUE, floored
 * — a 119-minute-old sale is "1h ago", never "2h ago", because rounding up would
 * age an event past something that really is 2h old and reorder the reader's
 * sense of the sequence.
 *
 * Beyond the tape's 24h live window it returns null rather than "2d ago": the
 * component's contract is that nothing older than 24h is shown AS LIVE, so an
 * out-of-window item should be dropped upstream, and a null here is the loud
 * signal that one slipped through.
 */
export function relativeAge(tsMs: number, nowMs: number): string | null {
  const ms = nowMs - tsMs;
  if (!Number.isFinite(ms)) return null;
  if (ms < 0) return "just now"; // a clock skew of a few seconds, not the future
  if (ms >= 24 * 3_600_000) return null;
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}
