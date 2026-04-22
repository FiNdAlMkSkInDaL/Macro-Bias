import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';

type PersistedRegimeArtifactRow = {
  artifact_version: string;
  created_at?: string;
  regime_matrix: unknown;
  source_trade_date: string;
};

export type TestLabPersistenceSummary = {
  experimentsTable: {
    available: boolean;
    rowCount: number;
  };
  regimeArtifactsTable: {
    available: boolean;
    latestCreatedAt: string | null;
    rowCount: number;
  };
};

const TEST_LAB_REGIME_ARTIFACT_VERSION = 'regime-research-v1';

function isMissingRelationError(error: { code?: string; message?: string } | null) {
  if (!error) {
    return false;
  }

  return (
    error.code === 'PGRST205' ||
    error.message?.includes('test_lab_regime_artifacts') === true ||
    error.message?.includes('test_lab_experiments') === true
  );
}

export async function getPersistedRegimeArtifact<T>(sourceTradeDate: string): Promise<T | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('test_lab_regime_artifacts')
    .select('artifact_version, regime_matrix, source_trade_date, created_at')
    .eq('source_trade_date', sourceTradeDate)
    .eq('artifact_version', TEST_LAB_REGIME_ARTIFACT_VERSION)
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) {
      return null;
    }

    throw error;
  }

  return ((data as PersistedRegimeArtifactRow | null)?.regime_matrix as T | null) ?? null;
}

export async function persistRegimeArtifact(sourceTradeDate: string, regimeMatrix: unknown) {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from('test_lab_regime_artifacts').upsert(
    {
      source_trade_date: sourceTradeDate,
      artifact_version: TEST_LAB_REGIME_ARTIFACT_VERSION,
      regime_matrix: regimeMatrix,
    },
    {
      onConflict: 'source_trade_date,artifact_version',
    },
  );

  if (error && !isMissingRelationError(error)) {
    throw error;
  }
}

export async function loadPersistedExperiments<
  T extends {
    changedModules: string[];
    createdAt: string;
    evaluationWindow: string;
    hypothesis: string;
    id: string;
    metrics: Array<{ label: string; value: string }>;
    modelVersion: string;
    nextAction: string;
    notes: string;
    outcome: string;
    owner: string;
    status: string;
    title: string;
  },
>(): Promise<T[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('test_lab_experiments')
    .select(
      'id, title, owner_email, status, outcome, model_version, evaluation_window, hypothesis, notes, next_action, changed_modules, metrics, created_at',
    )
    .order('created_at', { ascending: false });

  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }

    throw error;
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    title: String(row.title),
    owner: String(row.owner_email),
    status: String(row.status),
    outcome: String(row.outcome),
    modelVersion: String(row.model_version),
    evaluationWindow: String(row.evaluation_window),
    hypothesis: String(row.hypothesis),
    notes: String(row.notes),
    nextAction: String(row.next_action),
    changedModules: Array.isArray(row.changed_modules)
      ? row.changed_modules.filter((value): value is string => typeof value === 'string')
      : [],
    metrics: Array.isArray(row.metrics)
      ? row.metrics.filter(
          (value): value is { label: string; value: string } =>
            typeof value === 'object' &&
            value !== null &&
            'label' in value &&
            'value' in value &&
            typeof (value as { label: unknown }).label === 'string' &&
            typeof (value as { value: unknown }).value === 'string',
        )
      : [],
    createdAt: String(row.created_at).slice(0, 10),
  })) as T[];
}

export async function seedExperimentsIfTableExists(
  experiments: Array<{
    changedModules: string[];
    createdAt: string;
    evaluationWindow: string;
    hypothesis: string;
    id: string;
    metrics: Array<{ label: string; value: string }>;
    modelVersion: string;
    nextAction: string;
    notes: string;
    outcome: string;
    owner: string;
    status: string;
    title: string;
  }>,
) {
  const supabase = createSupabaseAdminClient();
  const rows = experiments.map((experiment) => ({
    id: experiment.id,
    title: experiment.title,
    owner_email: experiment.owner,
    status: experiment.status,
    outcome: experiment.outcome,
    model_version: experiment.modelVersion,
    evaluation_window: experiment.evaluationWindow,
    hypothesis: experiment.hypothesis,
    notes: experiment.notes,
    next_action: experiment.nextAction,
    changed_modules: experiment.changedModules,
    metrics: experiment.metrics,
    created_at: `${experiment.createdAt}T00:00:00Z`,
  }));

  const { error } = await supabase.from('test_lab_experiments').upsert(rows, {
    onConflict: 'id',
  });

  if (error && !isMissingRelationError(error)) {
    throw error;
  }
}

export async function getTestLabPersistenceSummary(): Promise<TestLabPersistenceSummary> {
  const supabase = createSupabaseAdminClient();

  const [artifactsRes, experimentsRes] = await Promise.all([
    supabase
      .from('test_lab_regime_artifacts')
      .select('created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(1),
    supabase.from('test_lab_experiments').select('id', { count: 'exact' }).limit(1),
  ]);

  const artifactsAvailable = !isMissingRelationError(artifactsRes.error);
  const experimentsAvailable = !isMissingRelationError(experimentsRes.error);

  if (artifactsRes.error && artifactsAvailable) {
    throw artifactsRes.error;
  }

  if (experimentsRes.error && experimentsAvailable) {
    throw experimentsRes.error;
  }

  const latestArtifactRow = ((artifactsRes.data ?? [])[0] as { created_at?: string } | undefined) ?? undefined;

  return {
    regimeArtifactsTable: {
      available: artifactsAvailable,
      rowCount: artifactsAvailable ? artifactsRes.count ?? 0 : 0,
      latestCreatedAt: artifactsAvailable ? latestArtifactRow?.created_at ?? null : null,
    },
    experimentsTable: {
      available: experimentsAvailable,
      rowCount: experimentsAvailable ? experimentsRes.count ?? 0 : 0,
    },
  };
}
