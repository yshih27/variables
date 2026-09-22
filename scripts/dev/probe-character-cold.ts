/**
 * One COLD `readCharacterDetail` in a fresh process, for the timing table in
 * probe-character-rollups.ts (the parent process has already inflated the
 * snapshot, so its own first read is not cold). Prints "<ms> <identities>".
 *
 *   SNAPSHOT_LOCAL_DIR=/tmp/blob npx tsx --env-file=.env.local scripts/dev/probe-character-cold.ts pokemon charizard
 */
// The parent passes its environment through (SNAPSHOT_LOCAL_DIR, the DB
// keys); no dotenv here, so stdout is exactly the one line the parent parses.
import { readCharacterDetail } from "../../src/lib/data/characterRollups";

const [ip, key] = process.argv.slice(2);
const t = performance.now();
readCharacterDetail(ip, key).then((d) => {
  console.log(`${(performance.now() - t).toFixed(1)} ${d ? d.identities : -1}`);
});
