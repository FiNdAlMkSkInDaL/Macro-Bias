/** Compare full-pipeline predictions from an earlier price snapshot with an extended one.
 * npx tsx scripts/verify-scoring-research-replay.ts <full-directory> <earlier-directory>
 * Checks actual preprocessing, production comparator, fitting and prediction outputs. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [fullDirectory, prefixDirectory] = process.argv.slice(2);
if (!fullDirectory || !prefixDirectory) throw Error('Supply full and earlier snapshot directories');
const read = (directory: string, name: string) => JSON.parse(readFileSync(join(directory, name), 'utf8'));
const fullReport = read(fullDirectory, 'report.json'), prefixReport = read(prefixDirectory, 'report.json');
assert(prefixReport.snapshotCutoff < fullReport.snapshotCutoff);
assert.equal(fullReport.fingerprints.code, prefixReport.fingerprints.code, 'Replays must use identical code');
assert.equal(fullReport.fingerprints.recipe, prefixReport.fingerprints.recipe, 'Replays must use identical recipe');
const comparisons: Record<string, number> = {};
for (const market of ['stocks', 'crypto']) {
  const complete = new Map<string, Record<string, unknown>>(read(fullDirectory, `${market}-predictions.json`).map((r: Record<string, unknown>) => [r.date, r]));
  const earlier: Record<string, unknown>[] = read(prefixDirectory, `${market}-predictions.json`);
  assert(earlier.length > 1000);
  for (const row of earlier) {
    const extended = complete.get(row.date as string); assert(extended, `Missing extended ${market} date ${row.date}`);
    const omitGenerationTime = ({ generatedAt: _time, ...rest }: Record<string, unknown>) => rest;
    assert.deepEqual(omitGenerationTime(extended), omitGenerationTime(row), `${market} ${row.date}: future extension changed an earlier forecast`);
    assert(String(row.ridgeMaxTrainingTargetDate) < String(row.date));
    assert(String(row.analogMaxTrainingTargetDate) < String(row.date));
  }
  comparisons[market] = earlier.length;
}
const evidence = { verifiedAt: new Date().toISOString(), earlierCutoff: prefixReport.snapshotCutoff, extendedCutoff: fullReport.snapshotCutoff,
  fingerprints: fullReport.fingerprints, comparisons, result: 'PASS_EXACT_APPEND_INVARIANCE',
  scope: 'All available earlier per-date forecasts, production raw scores/permissions, risk forecasts, feature context and training metadata are identical after appending later prices. Generation timestamps excluded. This is a leakage check, not a fresh holdout.' };
writeFileSync(join(fullDirectory, 'append-invariance.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ result: evidence.result, comparisons }));
