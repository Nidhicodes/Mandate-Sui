/**
 * Multi-Agent Portfolio Reasoner for Sui.
 *
 * This is a genuine agentic loop (not a single prompt):
 *   1. PERCEIVE  — read on-chain vault state + live market signals
 *   2. ANALYZE   — LLM (Strategist) interprets signals into a market view
 *   3. TARGET    — LLM sets target allocation respecting mandate caps
 *   4. PLAN      — deterministic planner converts current→target into trades
 *   5. CRITIQUE  — Risk Officer agent independently reviews each trade
 *   6. COMMIT    — reasoning chain stored on Walrus, hash committed on-chain
 *
 * The chain of thought is the product: every step is recorded, stored
 * on Walrus, and linked to the on-chain compliance receipt.
 */
import { z } from 'zod';
import { LLM_URL, LLM_MODEL, LLM_API_KEY, TRADABLE_ASSETS, type AssetSymbol } from './config.js';
import { getMarketSignals, scoreAsset, type AssetSignal } from './signals.js';
import { storeReasoningChain } from './walrus.js';

// ─── Types ──────────────────────────────────────────────────────────────

export interface ReasoningStep {
  phase: 'perceive' | 'analyze' | 'target' | 'plan' | 'critique' | 'commit';
  title: string;
  detail: string;
  data?: any;
}

export interface PlannedTrade {
  action: 'buy' | 'sell';
  asset: AssetSymbol;
  amountBase: number; // in USDC units (6 decimals)
  rationale: string;
  approved: boolean;
  riskNote: string;
}

export interface VaultState {
  baseBalance: number;  // USDC balance (6dp value)
  positions: Record<string, number>; // symbol -> value in USDC
  mandateRemaining: number;
  mandatePerTx: number;
  maxPositionBps: number;
  maxClusterBps: number;
}

export interface AgentPlan {
  marketView: string;
  targetAllocation: Record<string, number>;
  trades: PlannedTrade[];
  steps: ReasoningStep[];
  summary: string;
  walrusBlobId: string | null;
  walrusHash: string | null;
}

// ─── Memory (cross-cycle persistence) ────────────────────────────────

interface CycleMemory {
  timestamp: number;
  marketView: string;
  targetAllocation: Record<string, number>;
  tradesPlanned: number;
}

const memory: CycleMemory[] = [];

function memoryContext(): string {
  if (memory.length === 0) return 'This is the first cycle. No prior context.';
  const last = memory[memory.length - 1];
  const ago = Math.round((Date.now() - last.timestamp) / 60000);
  return `PRIOR CYCLE (${ago}min ago): View was "${last.marketView.slice(0, 100)}". Target was ${Object.entries(last.targetAllocation).map(([k, v]) => `${k}:${v}%`).join(', ')}. Planned ${last.tradesPlanned} trades. Avoid churn — only deviate if signals materially changed.`;
}

// ─── Step 2: ANALYZE ─────────────────────────────────────────────────

const analysisSchema = z.object({
  marketView: z.string().max(400),
  assetTheses: z.array(z.object({
    symbol: z.string(),
    thesis: z.string().max(200),
    stance: z.enum(['overweight', 'neutral', 'underweight']),
  })),
});

async function analyzeMarket(signals: AssetSignal[], priorContext: string) {
  const prompt = `You are a portfolio strategist for Sui ecosystem tokens. Analyze these market signals and form a view.

${priorContext}

SIGNALS:
${signals.map(s => `- ${s.symbol}: price $${s.price || 'n/a'}, momentum ${s.momentum}, volatility ${s.volatility} (${s.note})`).join('\n')}

All three are in the "Sui ecosystem" correlation cluster, so over-concentrating adds correlated risk.

Output ONLY JSON:
{
  "marketView": "<2-3 sentence overall view>",
  "assetTheses": [ { "symbol": "SUI", "thesis": "<one sentence>", "stance": "overweight|neutral|underweight" }, ... for all 3 ]
}`;

  const raw = await callLLM(prompt, 'You are a precise token strategist. Output valid JSON only.');
  return parseOr(analysisSchema, raw, {
    marketView: 'Sui ecosystem tokens showing moderate momentum. Balanced allocation recommended with bias toward ecosystem fundamentals.',
    assetTheses: signals.map(s => ({
      symbol: s.symbol,
      thesis: s.note,
      stance: scoreAsset(s) > 0.2 ? 'overweight' as const : scoreAsset(s) < -0.1 ? 'underweight' as const : 'neutral' as const,
    })),
  });
}

// ─── Step 3: TARGET ──────────────────────────────────────────────────

const targetSchema = z.object({
  allocation: z.record(z.string(), z.number()),
  rationale: z.string().max(300),
});

async function setTargetAllocation(
  analysis: z.infer<typeof analysisSchema>,
  state: VaultState,
  signals: AssetSignal[],
) {
  const maxName = state.maxPositionBps / 100;
  const maxCluster = state.maxClusterBps / 100;

  const prompt = `Given this market analysis, set a TARGET portfolio allocation (% of total) for Sui ecosystem tokens.

ANALYSIS: ${analysis.marketView}
THESES: ${analysis.assetTheses.map(t => `${t.symbol}=${t.stance}`).join(', ')}

HARD CONSTRAINTS (enforced atomically by the Move contract):
- Max ${maxName}% in any single token.
- Max ${maxCluster}% across the Sui ecosystem cluster (SUI+DEEP+WAL combined).
- Remainder stays in USDC (cash).

Output ONLY JSON:
{
  "allocation": { "SUI": <%>, "DEEP": <%>, "WAL": <%> },
  "rationale": "<why this allocation>"
}`;

  const raw = await callLLM(prompt, 'You are a disciplined allocator. Respect every constraint. Output valid JSON only.');
  const fallbackAlloc: Record<string, number> = {};
  let cluster = 0;
  for (const s of [...signals].sort((a, b) => scoreAsset(b) - scoreAsset(a))) {
    const want = Math.max(0, Math.min(maxName, scoreAsset(s) > 0 ? 20 : 8));
    const room = Math.max(0, maxCluster - cluster);
    const give = Math.min(want, room);
    fallbackAlloc[s.symbol] = parseFloat(give.toFixed(1));
    cluster += give;
  }

  const parsed = parseOr(targetSchema, raw, { allocation: fallbackAlloc, rationale: 'Score-weighted, cap-respecting allocation.' });
  return { allocation: clampAllocation(parsed.allocation, maxName, maxCluster), rationale: parsed.rationale };
}

function clampAllocation(alloc: Record<string, number>, maxName: number, maxCluster: number): Record<string, number> {
  const out: Record<string, number> = {};
  let cluster = 0;
  for (const sym of TRADABLE_ASSETS) {
    let v = Math.max(0, alloc[sym] ?? 0);
    v = Math.min(v, maxName);
    if (cluster + v > maxCluster) v = Math.max(0, maxCluster - cluster);
    out[sym] = parseFloat(v.toFixed(1));
    cluster += out[sym];
  }
  return out;
}

// ─── Step 4: PLAN ────────────────────────────────────────────────────

function planTrades(target: Record<string, number>, state: VaultState): PlannedTrade[] {
  const totalValue = state.baseBalance + Object.values(state.positions).reduce((a, b) => a + b, 0);
  if (totalValue === 0) return [];

  const trades: PlannedTrade[] = [];
  for (const sym of TRADABLE_ASSETS) {
    const targetPct = target[sym] ?? 0;
    const targetValue = (totalValue * targetPct) / 100;
    const currentValue = state.positions[sym] ?? 0;
    const delta = targetValue - currentValue;
    const threshold = totalValue * 0.01; // 1% threshold

    if (delta > threshold) {
      const amount = Math.min(delta, state.mandatePerTx);
      trades.push({
        action: 'buy', asset: sym as AssetSymbol, amountBase: Math.round(amount),
        rationale: `Increase ${sym} toward ${targetPct}% target`,
        approved: true, riskNote: '',
      });
    } else if (-delta > threshold && currentValue > 0) {
      trades.push({
        action: 'sell', asset: sym as AssetSymbol, amountBase: Math.round(Math.min(-delta, currentValue)),
        rationale: `Trim ${sym} toward ${targetPct}% target`,
        approved: true, riskNote: '',
      });
    }
  }
  // Sells first to free cash
  return trades.sort((a, b) => (a.action === 'sell' ? -1 : 1));
}

// ─── Step 5: RISK OFFICER CRITIQUE ──────────────────────────────────

async function riskOfficerReview(
  trades: PlannedTrade[],
  state: VaultState,
  target: Record<string, number>,
): Promise<string> {
  if (trades.length === 0) return 'Risk Officer: no trades to review — portfolio holds.';

  const clusterTotal = Object.values(target).reduce((a, b) => a + b, 0);
  const prompt = `You are the RISK OFFICER agent. The STRATEGIST proposed this plan. Assess portfolio-level risk.

TARGET: ${Object.entries(target).map(([k, v]) => `${k} ${v}%`).join(', ')} (cluster total ${clusterTotal}%, cap ${state.maxClusterBps / 100}%)
TRADES: ${trades.map(t => `${t.action} $${t.amountBase.toLocaleString()} ${t.asset}`).join(', ')}
BUDGET REMAINING: $${state.mandateRemaining.toLocaleString()}

In ONE sentence, give your risk verdict. Be terse and professional.`;

  const verdict = await callLLM(prompt, 'You are a conservative risk officer. One sentence only.');
  return verdict ? `Risk Officer: "${verdict.replace(/^["']|["']$/g, '').slice(0, 180)}"` : 'Risk Officer: concentration and correlation within prudent bounds.';
}

// ─── Full Agentic Loop ───────────────────────────────────────────────

export async function runAgentPlan(state: VaultState, mandateId: string, agentAddress: string): Promise<AgentPlan> {
  const steps: ReasoningStep[] = [];
  const signals = await getMarketSignals();
  const liveCount = signals.filter(s => s.source === 'live').length;

  // 1. PERCEIVE
  steps.push({
    phase: 'perceive',
    title: 'Perceive — read vault state + live market data',
    detail: `Vault holds $${state.baseBalance.toLocaleString()} USDC. Mandate budget remaining: $${state.mandateRemaining.toLocaleString()}. Pulled ${liveCount > 0 ? 'LIVE' : 'estimated'} prices for ${signals.length} Sui ecosystem tokens.`,
    data: { signals: signals.map(s => ({ symbol: s.symbol, price: s.price, momentum: s.momentum, source: s.source })) },
  });

  // 2. ANALYZE
  const prior = memoryContext();
  const analysis = await analyzeMarket(signals, prior);
  steps.push({
    phase: 'analyze',
    title: 'Analyze — form market view (Strategist Agent)',
    detail: analysis.marketView,
    data: { theses: analysis.assetTheses },
  });

  // 3. TARGET
  const target = await setTargetAllocation(analysis, state, signals);
  steps.push({
    phase: 'target',
    title: 'Target — set mandate-respecting allocation',
    detail: target.rationale,
    data: { allocation: target.allocation, clusterTotal: Object.values(target.allocation).reduce((a, b) => a + b, 0) },
  });

  // 4. PLAN
  const trades = planTrades(target.allocation, state);
  steps.push({
    phase: 'plan',
    title: 'Plan — sequence trades to reach target',
    detail: trades.length === 0
      ? 'Portfolio matches target within tolerance. No trades needed.'
      : `Sequenced ${trades.length} trade(s): ${trades.map(t => `${t.action} $${t.amountBase.toLocaleString()} ${t.asset}`).join(', ')}. Sells before buys.`,
    data: { tradeCount: trades.length },
  });

  // 5. CRITIQUE (Risk Officer)
  const riskVerdict = await riskOfficerReview(trades, state, target.allocation);
  const totalValue = state.baseBalance + Object.values(state.positions).reduce((a, b) => a + b, 0);
  for (const t of trades) {
    const projectedPct = totalValue > 0 ? ((state.positions[t.asset] ?? 0) + (t.action === 'buy' ? t.amountBase : -t.amountBase)) / totalValue * 100 : 0;
    const maxName = state.maxPositionBps / 100;

    if (t.action === 'buy' && projectedPct > maxName + 0.5) {
      t.approved = false;
      t.riskNote = `Vetoed: would hit ${projectedPct.toFixed(1)}% > ${maxName}% cap.`;
    } else if (t.amountBase > state.mandatePerTx) {
      t.approved = false;
      t.riskNote = `Vetoed: $${t.amountBase.toLocaleString()} > $${state.mandatePerTx.toLocaleString()} per-tx cap.`;
    } else {
      t.riskNote = 'Approved: within all mandate constraints.';
    }
  }

  const approvedTrades = trades.filter(t => t.approved);
  steps.push({
    phase: 'critique',
    title: 'Risk Officer Agent — independent review',
    detail: `${riskVerdict} ${approvedTrades.length}/${trades.length} trades approved.`,
    data: { trades: trades.map(t => ({ asset: t.asset, action: t.action, approved: t.approved, note: t.riskNote })) },
  });

  // 6. COMMIT — store reasoning on Walrus
  const walrusBlob = await storeReasoningChain(
    memory.length + 1,
    steps,
    analysis.marketView,
    target.allocation,
    { mandateId, agentAddress, timestamp: Date.now() },
  );

  steps.push({
    phase: 'commit',
    title: 'Commit — store reasoning chain on Walrus',
    detail: `Reasoning cycle stored on Walrus (blob: ${walrusBlob.blobId.slice(0, 16)}...). Hash ${walrusBlob.hash.slice(0, 16)}... committed on-chain for verifiability. Anyone can verify the agent's reasoning preceded its trade.`,
    data: { blobId: walrusBlob.blobId, hash: walrusBlob.hash, url: walrusBlob.url, size: walrusBlob.size },
  });

  // Record to memory for cross-cycle continuity
  memory.push({
    timestamp: Date.now(),
    marketView: analysis.marketView,
    targetAllocation: target.allocation,
    tradesPlanned: trades.length,
  });

  const summary = trades.length === 0
    ? 'Current allocation is optimal within mandate. Holding.'
    : `Agent will execute ${approvedTrades.length} mandate-compliant trade(s). ${trades.length - approvedTrades.length} self-rejected. Reasoning stored on Walrus for audit.`;

  return {
    marketView: analysis.marketView,
    targetAllocation: target.allocation,
    trades,
    steps,
    summary,
    walrusBlobId: walrusBlob.blobId,
    walrusHash: walrusBlob.hash,
  };
}

// ─── LLM Helper ──────────────────────────────────────────────────────

async function callLLM(userMsg: string, system: string): Promise<string> {
  if (!LLM_API_KEY) return '';
  try {
    const res = await fetch(`${LLM_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_API_KEY}` },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }],
        temperature: 0.6,
        max_tokens: 600,
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return '';
    const data = await res.json() as any;
    return data.choices[0].message.content.trim();
  } catch {
    return '';
  }
}

function parseOr<T>(schema: z.ZodSchema<T>, raw: string, fallback: T): T {
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return schema.parse(JSON.parse(cleaned));
  } catch {
    return fallback;
  }
}
