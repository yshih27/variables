/**
 * Type-only contract test: the partner rollup this backend emits must remain
 * assignable to the props of the DEPLOYED PlatformPartners component.
 *
 * Why this file exists rather than a comment: `PartnerAttribution` is declared
 * twice — once in the component (which owns the display contract and is already
 * shipped) and once in playerAnalytics.ts (which owns the snapshot, and carries a
 * superset with per-window fields the component ignores). Two declarations drift
 * silently, and the failure mode is invisible: the page reads
 * `snapshot.partners[key]`, so a renamed field doesn't crash, it just makes the
 * board never render. This turns that into a compile error.
 *
 * Verified to be non-vacuous: renaming `volumeUsd30d` in the snapshot type
 * produces 6 tsc errors rather than passing quietly.
 *
 * Zero runtime cost — types only; nothing here is emitted.
 */
import type { PartnerAttribution as ComponentProps } from "@/components/PlatformPartners";
import type { PartnerAttribution as SnapshotShape } from "./playerAnalytics";

/** The snapshot shape must satisfy what the component consumes. */
const _snapshotSatisfiesComponent: (s: SnapshotShape) => ComponentProps = (s) => s;

export default _snapshotSatisfiesComponent;
