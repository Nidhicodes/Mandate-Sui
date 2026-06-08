'use client';

import { useState, useEffect } from 'react';
import {
  runPlan, executeCycle, getVault, getMemory, resetVault, walrusUrl,
  type PlanResponse, type VaultState, type MemoryEntry, type ReasoningStep,
} from '@/lib/api';
import { WalletConnect } from '@/components/WalletConnect';
import { OnChainActions } from '@/components/OnChainActions';

export default function Home() {
  return (
    <main className="pt-16">
      <Hero />
      <Dashboard />
      <HowItWorks />
      <Footer />
    </main>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// HERO
// ═══════════════════════════════════════════════════════════════════════

function Hero() {
  return (
    <section className="relative min-h-[70vh] flex items-center overflow-hidden">
      <div className="gradient-orb w-[600px] h-[600px] -top-40 -left-40" style={{ background: 'rgba(99,102,241,0.15)' }} />
      <div className="gradient-orb w-[400px] h-[400px] top-20 right-[-100px]" style={{ background: 'rgba(77,162,255,0.1)' }} />
      <div className="gradient-orb w-[300px] h-[300px] bottom-10 left-1/3" style={{ background: 'rgba(16,185,129,0.08)' }} />

      <div className="relative max-w-7xl mx-auto px-6 py-24">
        <div className="max-w-4xl space-y-8">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
              <span className="w-2 h-2 rounded-full bg-emerald-400 pulse-soft" />
              Deployed on Sui Testnet
            </span>
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium" style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', color: '#818cf8' }}>
              Walrus · Verifiable Memory
            </span>
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium" style={{ background: 'rgba(77,162,255,0.08)', border: '1px solid rgba(77,162,255,0.2)', color: '#4DA2FF' }}>
              Sui Overflow 2026
            </span>
          </div>

          <h1 className="text-5xl md:text-7xl leading-[0.95] tracking-tight">
            <span className="block text-white font-semibold">AI agents reason freely.</span>
            <span className="block font-light italic gradient-text mt-2">Walrus proves every decision.</span>
          </h1>

          <p className="text-lg text-gray-400 max-w-2xl leading-relaxed">
            A multi-agent portfolio system on Sui where every reasoning cycle is stored as a <span className="text-indigo-300 font-medium">verifiable blob on Walrus</span>, every trade is <span className="text-emerald-300 font-medium">atomically enforced by Move objects</span>, and anyone can prove: the agent&apos;s reasoning preceded its action.
          </p>

          <div className="flex flex-wrap items-center gap-4 pt-4">
            <a href="#proof" className="btn-primary">
              See It Live
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </a>
            <a href="#how" className="btn-secondary">Architecture</a>
            <a href="https://suiscan.xyz/testnet/object/0xa178dc05ac6fe50a10d555808b903badb94465e2a23f7f9a1c79764992672de7" target="_blank" rel="noreferrer" className="btn-secondary">
              View on SuiScan ↗
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// DASHBOARD — the interactive proof
// ═══════════════════════════════════════════════════════════════════════

function Dashboard() {
  const [vault, setVault] = useState<VaultState | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [memory, setMemory] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [revealed, setRevealed] = useState(0);
  const [txResults, setTxResults] = useState<any[]>([]);

  useEffect(() => {
    getVault().then(setVault).catch(() => {});
    getMemory().then(setMemory).catch(() => {});
  }, []);

  async function handleRun() {
    setLoading(true);
    setPlan(null);
    setRevealed(0);
    try {
      const result = await runPlan();
      setPlan(result);
      setVault(await getVault());
      setMemory(await getMemory());
      // Reveal steps one-by-one for the "thinking" effect
      result.steps.forEach((_, i) => {
        setTimeout(() => setRevealed(r => r + 1), i * 500);
      });
    } catch (e: any) {
      console.error(e);
    }
    setLoading(false);
  }

  async function handleExecute() {
    if (!plan) return;
    setExecuting(true);
    setTxResults([]);
    try {
      const result = await executeCycle(plan.cycleId);
      setTxResults(result.onChainResults || []);
      // Update vault and memory, but keep existing plan (don't overwrite with different shape)
      setVault(await getVault());
      setMemory(await getMemory());
    } catch (e: any) {
      console.error(e);
    }
    setExecuting(false);
  }

  return (
    <div id="proof" className="max-w-7xl mx-auto px-6 py-16 space-y-8 scroll-mt-20">
      <header className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-400 via-purple-400 to-emerald-400 bg-clip-text text-transparent">
              Mandate Memory
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Verifiable Agent Reasoning · Move-Enforced Mandates · Walrus Audit Trail
            </p>
          </div>
          <WalletConnect />
        </div>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Vault Balance', value: vault ? `$${vault.baseBalance.toLocaleString()}` : '...', color: 'text-white' },
          { label: 'Mandate Budget', value: vault ? `$${vault.mandateRemaining.toLocaleString()}` : '...', color: 'text-emerald-400' },
          { label: 'Cycles on Walrus', value: memory.length.toString(), color: 'text-indigo-400' },
          { label: 'Per-Tx Cap', value: vault ? `$${vault.mandatePerTx.toLocaleString()}` : '...', color: 'text-amber-400' },
        ].map(s => (
          <div key={s.label} className="card p-5">
            <p className="text-[11px] font-medium uppercase tracking-widest text-gray-500">{s.label}</p>
            <p className={`text-2xl font-bold mt-2 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        {/* Left: Controls + Memory */}
        <div className="lg:col-span-4 space-y-4">
          <div className="card p-6 space-y-4">
            <h3 className="text-sm font-semibold text-white">Agent Controls</h3>
            <button onClick={handleRun} disabled={loading} className="btn-primary w-full justify-center">
              {loading ? (
                <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Reasoning...</>
              ) : '⚡ Run Agent Cycle'}
            </button>
            {plan && plan.trades.some(t => t.approved) && (
              <button onClick={handleExecute} disabled={executing} className="btn-secondary w-full justify-center" style={{ background: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.3)', color: '#34d399' }}>
                {executing ? (
                  <><span className="w-4 h-4 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" /> Executing on-chain...</>
                ) : '✓ Execute On-Chain (Real PTB)'}
              </button>
            )}

            {/* On-chain transaction results */}
            {txResults.length > 0 && (
              <div className="card-inner p-4 space-y-2">
                <p className="text-[10px] uppercase tracking-widest text-emerald-400 font-medium">On-Chain Execution Results</p>
                {txResults.map((r: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className={`w-1.5 h-1.5 rounded-full mt-1.5 ${r.onchain.success ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-300">
                        {r.trade.action} {r.trade.asset.slice(0,10)}... — ${r.trade.amount.toLocaleString()}
                        {r.onchain.success ? ' ✓' : ` ✗ ${r.onchain.error}`}
                      </p>
                      {r.onchain.digest && (
                        <a href={`https://suiscan.xyz/testnet/tx/${r.onchain.digest}`} target="_blank" rel="noreferrer"
                          className="text-[10px] font-mono text-indigo-400 hover:text-indigo-300">
                          tx: {r.onchain.digest.slice(0, 24)}... ↗
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button onClick={async () => { await resetVault(); setVault(await getVault()); setPlan(null); setMemory([]); }} className="btn-secondary w-full justify-center text-xs">
              ↺ Reset Vault
            </button>
          </div>

          {/* Walrus Memory */}
          <div className="card p-6 space-y-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-400" /> Walrus Memory
            </h3>
            <p className="text-[11px] text-gray-500">Each entry is a verifiable reasoning blob. Click to view on Walrus.</p>
            {memory.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-4">No cycles yet</p>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {memory.map(e => (
                  <a key={e.id} href={walrusUrl(e.walrusBlobId)} target="_blank" rel="noreferrer"
                    className="block card-inner p-3 hover:border-indigo-500/30 transition group">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono text-indigo-400">Cycle #{e.id}</span>
                      {e.executed && <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-300">executed</span>}
                    </div>
                    <p className="text-[11px] text-gray-500 truncate">{e.summary}</p>
                    <p className="text-[10px] text-indigo-400/60 font-mono mt-1 group-hover:text-indigo-300 transition">
                      🔗 {e.walrusBlobId.slice(0, 24)}... ↗
                    </p>
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Positions */}
          {vault && Object.keys(vault.positions).length > 0 && (
            <div className="card p-6 space-y-3">
              <h3 className="text-sm font-semibold text-white">Portfolio Positions</h3>
              {Object.entries(vault.positions).map(([sym, val]) => {
                const pct = vault.totalValue > 0 ? (val / vault.totalValue) * 100 : 0;
                return (
                  <div key={sym} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-300">{sym}</span>
                      <span className="text-gray-500">{pct.toFixed(1)}% · ${val.toLocaleString()}</span>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-indigo-500 to-blue-500 rounded-full transition-all duration-700"
                        style={{ width: `${Math.min(pct * (100/30), 100)}%` }} />
                    </div>
                  </div>
                );
              })}
              <div className="pt-2 border-t border-gray-800 flex justify-between text-xs">
                <span className="text-gray-500">Cluster total</span>
                <span className={`font-medium ${Object.values(vault.positions).reduce((a,b)=>a+b,0) / vault.totalValue * 100 > 50 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {(Object.values(vault.positions).reduce((a,b)=>a+b,0) / vault.totalValue * 100).toFixed(1)}% / 60% cap
                </span>
              </div>
            </div>
          )}

          {/* On-Chain Actions (wallet connect) */}
          <OnChainActions />
        </div>

        {/* Right: Reasoning Chain */}
        <div className="lg:col-span-8">
          {plan ? (
            <div className="card p-8 space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white">Reasoning Chain</h3>
                  <p className="text-xs text-gray-500 mt-1">Cycle #{plan.cycleId} · {plan.steps.length} phases · Strategist + Risk Officer agents</p>
                </div>
                {plan.walrus.blobId && !plan.walrus.blobId.startsWith('local_') && (
                  <a href={walrusUrl(plan.walrus.blobId)} target="_blank" rel="noreferrer"
                    className="btn-secondary text-xs" style={{ borderColor: 'rgba(99,102,241,0.3)', color: '#818cf8' }}>
                    View on Walrus ↗
                  </a>
                )}
              </div>

              {/* Steps */}
              <div className="space-y-1">
                {plan.steps.slice(0, revealed).map((step, i) => (
                  <ReasoningStepCard key={i} step={step} index={i} total={plan.steps.length} />
                ))}
                {revealed < plan.steps.length && (
                  <div className="flex items-center gap-3 py-3 px-4">
                    <span className="w-4 h-4 border-2 border-indigo-500/30 border-t-indigo-400 rounded-full animate-spin" />
                    <span className="text-xs text-gray-500">Thinking...</span>
                  </div>
                )}
              </div>

              {/* Trades */}
              {revealed >= plan.steps.length && plan.trades.length > 0 && (
                <div className="space-y-2 pt-4 border-t border-gray-800">
                  <p className="text-[11px] font-medium uppercase tracking-widest text-gray-500">Proposed Trades</p>
                  {plan.trades.map((t, i) => (
                    <div key={i} className={`flex items-center gap-3 card-inner px-4 py-3 ${t.approved ? '' : 'opacity-50'}`}>
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${t.action === 'buy' ? 'bg-emerald-900/40 text-emerald-300' : 'bg-amber-900/40 text-amber-300'}`}>
                        {t.action}
                      </span>
                      <span className="text-sm font-medium text-white">{t.asset}</span>
                      <span className="text-sm text-gray-400">${t.amountBase.toLocaleString()}</span>
                      <span className="flex-1" />
                      <span className={`text-[11px] ${t.approved ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {t.approved ? '✓ Approved' : '✗ Vetoed'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Walrus proof */}
              {revealed >= plan.steps.length && plan.walrus.blobId && (
                <div className="card-inner p-4 space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-widest text-indigo-400">Verifiable Proof (Walrus)</p>
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <p className="text-gray-500">Blob ID</p>
                      <p className="font-mono text-indigo-300 break-all">{plan.walrus.blobId}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">SHA-256 Hash</p>
                      <p className="font-mono text-gray-400 break-all">{plan.walrus.hash}</p>
                    </div>
                  </div>
                  {!plan.walrus.blobId.startsWith('local_') && (
                    <p className="text-[10px] text-emerald-400 flex items-center gap-1.5 pt-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      Stored on Walrus testnet · Retrieve at aggregator to verify hash(blob) == on-chain commitment
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="card p-16 text-center space-y-4">
              <p className="text-5xl">🧠</p>
              <h3 className="text-xl font-semibold text-white">Run the Agent</h3>
              <p className="text-sm text-gray-500 max-w-md mx-auto">
                Click &ldquo;Run Agent Cycle&rdquo; to start a 6-phase reasoning loop.
                The Strategist analyzes markets, the Risk Officer reviews trades,
                and the full chain is committed to Walrus before execution.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Reasoning Step Card ─────────────────────────────────────────────

const PHASE_META: Record<string, { icon: string; color: string; bg: string }> = {
  perceive: { icon: '👁️', color: 'text-gray-400', bg: 'bg-gray-800' },
  analyze: { icon: '🧠', color: 'text-purple-400', bg: 'bg-purple-900/20' },
  target: { icon: '🎯', color: 'text-amber-400', bg: 'bg-amber-900/20' },
  plan: { icon: '📋', color: 'text-blue-400', bg: 'bg-blue-900/20' },
  critique: { icon: '🛡️', color: 'text-rose-400', bg: 'bg-rose-900/20' },
  commit: { icon: '🔗', color: 'text-indigo-400', bg: 'bg-indigo-900/20' },
};

function ReasoningStepCard({ step, index, total }: { step: ReasoningStep; index: number; total: number }) {
  const meta = PHASE_META[step.phase] || { icon: '•', color: 'text-gray-400', bg: 'bg-gray-800' };

  return (
    <div className="flex gap-4 fade-up" style={{ animationDelay: `${index * 100}ms` }}>
      <div className="flex flex-col items-center">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${meta.bg}`}>
          {meta.icon}
        </div>
        {index < total - 1 && <div className="phase-line flex-1 mt-1" />}
      </div>
      <div className="flex-1 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-[10px] font-medium uppercase tracking-widest ${meta.color}`}>{step.phase}</span>
          {step.phase === 'analyze' && <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-900/30 text-purple-300 border border-purple-500/20">Strategist</span>}
          {step.phase === 'critique' && <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-900/30 text-rose-300 border border-rose-500/20">Risk Officer</span>}
        </div>
        <p className="text-sm text-white font-medium">{step.title}</p>
        <p className="text-sm text-gray-400 mt-1 leading-relaxed">{step.detail}</p>

        {/* Perceive: show signal badges */}
        {step.phase === 'perceive' && step.data?.signals && (
          <div className="flex flex-wrap gap-2 mt-3">
            {step.data.signals.map((s: any) => (
              <div key={s.symbol} className="card-inner px-3 py-2 min-w-[100px]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-white">{s.symbol}</span>
                  <span className={`text-[8px] px-1 py-0.5 rounded ${s.source === 'live' ? 'bg-emerald-900/40 text-emerald-300' : 'bg-gray-700 text-gray-400'}`}>
                    {s.source === 'live' ? 'LIVE' : 'EST'}
                  </span>
                </div>
                <p className="text-sm font-mono text-white mt-0.5">${s.price?.toFixed(4)}</p>
              </div>
            ))}
          </div>
        )}

        {/* Target: show allocation */}
        {step.phase === 'target' && step.data?.allocation && (
          <div className="flex flex-wrap gap-2 mt-2">
            {Object.entries(step.data.allocation as Record<string, number>).map(([sym, pct]) => (
              <span key={sym} className="text-xs px-2 py-1 rounded-lg bg-emerald-900/20 text-emerald-300 border border-emerald-500/20">
                {sym}: {pct}%
              </span>
            ))}
            <span className="text-xs px-2 py-1 rounded-lg bg-gray-800 text-gray-400">
              Cluster: {step.data.clusterTotal?.toFixed(1)}% / 60%
            </span>
          </div>
        )}

        {/* Critique: show trade verdicts */}
        {step.phase === 'critique' && step.data?.trades && (
          <div className="mt-2 space-y-1">
            {step.data.trades.map((t: any, j: number) => (
              <div key={j} className="flex items-center gap-2 text-[11px]">
                <span className={`w-1.5 h-1.5 rounded-full ${t.approved ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                <span className="text-gray-400">{t.action} {t.asset}</span>
                <span className={t.approved ? 'text-emerald-400/70' : 'text-rose-400/70'}>
                  {t.approved ? 'approved' : 'vetoed'} — {t.note?.slice(0, 50)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Commit: show Walrus data */}
        {step.phase === 'commit' && step.data && (
          <div className="mt-2 card-inner p-3 space-y-1">
            <p className="text-[10px] text-indigo-400 font-mono">blob: {step.data.blobId}</p>
            <p className="text-[10px] text-gray-500 font-mono">hash: {step.data.hash}</p>
            {step.data.url && !step.data.url.startsWith('local') && (
              <a href={step.data.url} target="_blank" rel="noreferrer" className="text-[10px] text-indigo-300 hover:text-indigo-200 underline">
                Verify on Walrus ↗
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// HOW IT WORKS
// ═══════════════════════════════════════════════════════════════════════

function HowItWorks() {
  return (
    <section id="how" className="max-w-7xl mx-auto px-6 py-20 scroll-mt-20">
      <div className="text-center mb-12">
        <p className="text-[11px] font-medium uppercase tracking-widest text-emerald-400 mb-3">Architecture</p>
        <h2 className="text-2xl md:text-3xl font-semibold text-white tracking-tight">Why Sui + Walrus specifically</h2>
        <p className="text-gray-500 text-sm mt-3 max-w-xl mx-auto">Every component uses a Sui primitive that cannot be replicated elsewhere.</p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {[
          {
            title: 'Move Objects as Mandates',
            desc: 'The agent\'s authority is a typed Move object — key + store, no copy. Cannot be forged. Cannot be duplicated. The mandate IS a resource.',
            icon: '🏛️',
            tag: 'Sui Move',
            tagColor: 'text-blue-400 bg-blue-900/20 border-blue-500/20',
          },
          {
            title: 'Hot-Potato Atomic Enforcement',
            desc: 'MandateReceipt has no drop ability. authorize() and execute() must happen in the same PTB. Partial enforcement is impossible by construction.',
            icon: '🔒',
            tag: 'PTBs',
            tagColor: 'text-emerald-400 bg-emerald-900/20 border-emerald-500/20',
          },
          {
            title: 'Walrus Verifiable Memory',
            desc: 'Full reasoning chains stored as blobs. Hash committed on-chain. Anyone can verify: hash(walrus_blob) == on-chain commitment. The audit trail is cryptographic.',
            icon: '🔗',
            tag: 'Walrus',
            tagColor: 'text-indigo-400 bg-indigo-900/20 border-indigo-500/20',
          },
        ].map(item => (
          <div key={item.title} className="card p-6 space-y-4">
            <div className="text-3xl">{item.icon}</div>
            <span className={`inline-block text-[10px] px-2 py-1 rounded-lg border ${item.tagColor}`}>{item.tag}</span>
            <h4 className="text-white font-semibold">{item.title}</h4>
            <p className="text-sm text-gray-400 leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </div>

      {/* Enforcement layers */}
      <div className="mt-16 card p-8">
        <h3 className="text-lg font-semibold text-white mb-6">6 Enforcement Layers (every trade, atomically)</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { num: '1', name: 'Asset Check', revert: 'AssetNotPermitted' },
            { num: '2', name: 'Per-Tx Cap', revert: 'PerTxExceeded' },
            { num: '3', name: 'Budget Cap', revert: 'CumulativeExceeded' },
            { num: '4', name: 'Position Cap', revert: 'PositionLimit' },
            { num: '5', name: 'Cluster Cap', revert: 'ClusterExceeded' },
            { num: '6', name: 'Kill Switch', revert: 'MandateFrozen' },
          ].map(l => (
            <div key={l.num} className="card-inner p-4 text-center space-y-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-900/30 text-emerald-400 text-xs font-bold flex items-center justify-center mx-auto">
                {l.num}
              </div>
              <p className="text-xs text-white font-medium">{l.name}</p>
              <p className="text-[9px] font-mono text-rose-400/60">{l.revert}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// FOOTER
// ═══════════════════════════════════════════════════════════════════════

function Footer() {
  return (
    <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-gray-800">
      <div className="flex flex-col md:flex-row items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold gradient-text">Mandate Memory</h3>
          <p className="text-xs text-gray-500 mt-1">Sui Overflow 2026 · Walrus Track</p>
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <a href="https://suiscan.xyz/testnet/object/0xa178dc05ac6fe50a10d555808b903badb94465e2a23f7f9a1c79764992672de7" target="_blank" rel="noreferrer" className="hover:text-white transition">Package ↗</a>
          <span>·</span>
          <span>Move contracts · 6 tests · 3 modules</span>
          <span>·</span>
          <span>MIT License</span>
        </div>
      </div>
    </footer>
  );
}
