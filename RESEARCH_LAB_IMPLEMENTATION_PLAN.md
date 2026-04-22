# Research Lab Implementation Plan

## Vision

Build a private `/test/*` Research Lab inside Macro Bias that lets us develop the next-generation system without exposing unfinished work to live users. The lab should feel like a serious internal regime-intelligence platform rather than a hidden staging page.

This system should help Macro Bias evolve from:

- daily score + briefing

into:

- a live regime research system that explains what kind of market this is, how reliable that read is, what tends to work in this state, and what breaks the model

The Research Lab should improve the product and also be genuinely impressive to quants and data scientists.

## Core Principles

- Keep all experimental work off live until explicitly promoted.
- Keep all test routes under `/test/*`.
- Restrict access to `finphillips21@gmail.com` only.
- Preserve the integrity of the current live quant score.
- Treat news as a separate trust or disruption layer, not as an unbounded replacement for the core score.
- Prioritize scientific rigor, walk-forward validation, and auditability over flashy visuals.
- Make the research surfaces clean, legible, and dashboard-like.

## Access and Isolation Requirements

- Every test URL must begin with `/test/`.
- Only the signed-in account `finphillips21@gmail.com` can access `/test/*`.
- Unauthenticated users should be redirected to `/` with a `redirectTo` query param.
- Signed-in users with any other email should be redirected away from `/test/*`.
- `/test/*` pages should not appear in navigation, sitemap, or public discovery flows.
- `/test/*` pages should be marked `noindex, nofollow`.
- Test analytics should be separable from live analytics.
- Test outputs should not be sent to the public list by default.

## Product Thesis

Macro Bias should become a system that can answer:

- What kind of day is this?
- How much should I trust the model today?
- What tends to work in this environment?
- What historical periods actually resemble this setup?
- What breaks the read?
- Is the model itself still behaving as expected?

## Planned Research Lab Modules

### 1. `/test`

Research Lab home page with:

- module directory
- current system status
- last refresh timestamp
- quick links to all research surfaces
- clear "TEST LAB" visual identity

### 2. `/test/regime-map`

Historical regime atlas with:

- clustered market states
- nearest analogs
- regime summaries
- current-day positioning inside the map
- major historical regime paths

### 3. `/test/transitions`

Transition engine with:

- regime transition matrix
- persistence probabilities
- next-state likelihoods
- conditional forward outcomes

### 4. `/test/confidence`

Trust and confidence decomposition with:

- signal strength
- analog agreement
- feature stability
- data quality
- historical regime clarity
- news disruption
- drift pressure

### 5. `/test/cross-sectional`

Cross-sectional regime effects with:

- sectors
- factors
- style buckets
- relative winners and losers by regime
- confidence bands and sample thresholds

### 6. `/test/news`

News disruption engine with:

- structured event tags
- disruption severity
- pattern-validity estimate
- relationship to analog reliability

### 7. `/test/data-health`

Model health and drift monitoring with:

- feature drift
- analog quality drift
- hit-rate drift
- live vs backtest gaps
- data freshness and missingness

### 8. `/test/experiments`

Experiment ledger with:

- experiment list
- hypotheses
- model versions
- metrics
- conclusions
- promotion or rejection state

### 9. `/test/live-vs-history`

Daily research cockpit with:

- today’s regime
- trust stack
- nearest analogs
- likely next states
- cross-sectional expectations
- news disruption state
- data-health warnings

## Phase Plan

## Phase 0. Planning and Scaffolding

### Goal

Define the architecture before model work begins.

### Steps

1. Define `/test/*` route map.
2. Define shared access-control helper.
3. Define test metadata and noindex rules.
4. Define shared lab layout.
5. Define test analytics naming.
6. Define test API namespace.

### Deliverables

- route map
- access policy
- shared lab shell specification
- test analytics naming spec

## Phase 1. Private `/test` Shell

### Goal

Create the private Research Lab environment.

### Steps

1. Extend middleware to protect `/test/*`.
2. Add reusable server-side access helper.
3. Add test-only layout.
4. Add Research Lab landing page.
5. Add placeholder module pages.
6. Ensure all pages are `noindex`.
7. Add clear unauthorized behavior.
8. Add test analytics tagging conventions.

### Deliverables

- working private `/test/*` section
- access restricted to `finphillips21@gmail.com`
- stable foundation for later research modules

## Phase 2. Regime Map Data Model

### Goal

Build the backbone for historical regime analysis.

### Steps

1. Audit current Macro Bias features.
2. Design expanded regime-analysis feature schema.
3. Build historical feature snapshot storage.
4. Normalize and standardize features.
5. Define training and validation windows.
6. Build first embedding pipeline.
7. Build first clustering pipeline.
8. Store assignments and summaries.
9. Add first regime map UI.

### Deliverables

- historical feature matrix
- first regime taxonomy
- first map visualization
- first cluster summaries

## Phase 3. Transition Engine

### Goal

Estimate what tends to happen next from each regime.

### Steps

1. Build transition matrix.
2. Estimate next-state probabilities.
3. Compute forward return and volatility summaries.
4. Add persistence and instability measures.
5. Build transition page UI.

### Deliverables

- transition matrix
- next-regime summaries
- forward outcome summaries

## Phase 4. Confidence Decomposition

### Goal

Quantify how much the model should be trusted and why.

### Steps

1. Define trust sub-scores.
2. Create scoring formulas.
3. Backtest confidence usefulness.
4. Build confidence dashboard.
5. Add current-day trust snapshot.

### Deliverables

- trust decomposition framework
- confidence UI
- historical trust validation

## Phase 5. Cross-Sectional Effects

### Goal

Translate regimes into actionable relative behavior.

### Steps

1. Define groups and universes.
2. Build historical return panels.
3. Estimate regime-conditional spreads.
4. Add significance and stability filtering.
5. Build cross-sectional page UI.

### Deliverables

- regime-conditioned winners and losers
- spread tables
- filtered, stable relationships

## Phase 6. News Disruption Engine

### Goal

Measure when news invalidates the historical read.

### Steps

1. Define event taxonomy.
2. Build headline ingestion pipeline.
3. Add structured tagger.
4. Add disruption severity logic.
5. Estimate analog validity impact.
6. Build news module UI.

### Deliverables

- disruption score
- event tags
- pattern-validity layer

## Phase 7. Drift and Model Health

### Goal

Monitor whether the model’s assumptions are decaying.

### Steps

1. Define drift metrics.
2. Add feature drift monitoring.
3. Add hit-rate drift monitoring.
4. Add analog quality decay monitoring.
5. Build data-health UI.

### Deliverables

- health dashboard
- drift alerts
- model deterioration signals

## Phase 8. Experiment Ledger

### Goal

Track every serious model change and its evidence.

### Steps

1. Design experiment schema.
2. Add experiment records and statuses.
3. Attach metrics and artifacts.
4. Build experiments UI.
5. Add compare view.
6. Add promotion or rejection state.

### Deliverables

- experiment log
- versioned research workflow
- promotion evidence trail

## Phase 9. Daily Research Cockpit

### Goal

Bring all research signals together into one private daily decision surface.

### Steps

1. Build `/test/live-vs-history`.
2. Show current regime and trust.
3. Show analogs and transition tendencies.
4. Show cross-sectional expectations.
5. Show news disruption and health warnings.
6. Optionally generate a private research briefing.

### Deliverables

- one-page research cockpit
- complete daily internal read

## Phase 10. Promotion Framework

### Goal

Define what earns promotion from the lab into live product surfaces.

### Promotion Rules

- must outperform baseline on defined metrics
- must survive walk-forward testing
- must remain interpretable
- must improve decision quality, not just backtest cosmetics
- must not introduce fragile complexity without clear user benefit

## Technical Requirements

### Routing and Access Control

- middleware protection for `/test/*`
- shared server-side allowlist helper
- page-level and API-level enforcement
- safe redirects for unauthorized access

### Analytics

Suggested test events:

- `test_page_view`
- `test_module_view`
- `test_experiment_view`
- `test_regime_map_interaction`
- `test_transition_view`
- `test_confidence_view`
- `test_news_view`
- `test_experiment_created`
- `test_experiment_status_changed`

Suggested metadata:

- `surface`
- `module`
- `experiment_id`
- `model_version`

### Storage

New or isolated data structures will likely be needed for:

- historical feature snapshots
- regime assignments
- embedding coordinates
- transition statistics
- confidence decompositions
- cross-sectional regime statistics
- structured news-event tags
- drift metrics
- experiments
- model versions

### UX

- keep the clean Macro Bias dashboard aesthetic
- avoid cluttered notebook-style interfaces
- structure every page around one primary question
- make module maturity visible with statuses like `research`, `experimental`, `candidate`, `ready`

### Quant Rigor

- walk-forward validation
- benchmark comparisons
- uncertainty visibility
- no lookahead bias
- no unsupported causal storytelling

## Risks and Mitigations

### Risk: flashy but weak system

Mitigation:

- validation first
- benchmarks everywhere
- experiment logging from the start

### Risk: contaminating the live product

Mitigation:

- hard route isolation
- test-only analytics and APIs
- no promotion without explicit approval

### Risk: research UI becomes unusable

Mitigation:

- one question per page
- summary home page for synthesis
- consistent layout and card system

### Risk: news layer becomes discretionary mush

Mitigation:

- keep it separate from the core score
- use structured event tags
- cap influence through trust logic
- measure usefulness explicitly

### Risk: overbuilding before learning

Mitigation:

- phased delivery
- each phase must produce a usable artifact

## Recommended Build Order

1. `/test` private shell and access control
2. regime-map data model
3. regime map UI
4. transition engine
5. confidence decomposition
6. cross-sectional effects
7. news disruption engine
8. drift dashboard
9. experiment ledger
10. daily research cockpit

## Definition of Success

The Research Lab is successful when:

- only `finphillips21@gmail.com` can access it
- `/test/*` is fully isolated from public users
- one private dashboard can show:
  - current regime
  - trust decomposition
  - nearest analogs
  - likely next states
  - what tends to work in this regime
  - whether news is breaking the pattern
  - whether the model itself is drifting
- every serious model idea can be logged, tested, compared, and either promoted or rejected

## Immediate Next Step

Start with:

- Phase 1 implementation
- plus the data design work for Phase 2

That gives Macro Bias a private sandbox to build something genuinely serious without disturbing the live product.
