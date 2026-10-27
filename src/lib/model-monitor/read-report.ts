import 'server-only';
import policy from '../../../docs/model-monitor-policy.json';
import { createSupabaseAdminClient } from '../supabase/admin';
import { readModelEvents, summarizeForward } from '../model-forward/service';
import { validSavedPrediction, validSavedOutcome } from '../model-forward/records';
import { MODEL_FORWARD } from '../model-forward/recipe';
import { FORWARD_MODEL_HASH } from '../model-forward/fingerprint';
import { isCompletedPriceDate } from '../market-data/completed-price-bars';

// The same pure projection and policy are used by the local and independent hosted monitors.
const { buildForwardReport } = require('../../../scripts/lib/build-forward-report.cjs') as {
  buildForwardReport: (input: Record<string, unknown>) => Record<string, unknown>;
};
export async function readHostedForwardReport() {
  const admin = createSupabaseAdminClient({ timeoutMs: 15_000 });
  const events = await readModelEvents(admin);
  return { ...buildForwardReport({ now: new Date(), events, summarizeForward, validSavedPrediction, validSavedOutcome, isCompletedPriceDate,
    experiment: MODEL_FORWARD, policy }), modelHash: FORWARD_MODEL_HASH,
    sourceRevision: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || process.env.MODEL_SOURCE_REVISION?.trim() || null,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null };
}
