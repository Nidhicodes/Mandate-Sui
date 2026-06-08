/**
 * Mandate Memory — API Server
 *
 * Endpoints:
 *   GET  /health          — status
 *   POST /api/plan        — run the full agent reasoning loop
 *   POST /api/execute     — execute approved trades on-chain
 *   GET  /api/memory      — list all committed reasoning cycles
 *   GET  /api/memory/:id  — retrieve a specific reasoning chain from Walrus
 *   GET  /api/vault       — current vault state
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { PORT, MANDATE_ID, MEMORY_STORE_ID, SUI_NETWORK, LLM_API_KEY, LLM_MODEL, PACKAGE_ID, VAULT_ID } from './config.js';
import { runAgentPlan, type VaultState } from './agent.js';
import { retrieveReasoningChain } from './walrus.js';
import { executeMandatedBuy, readVaultOnChain, readMandateOnChain, getAgentAddress, getAgentBalance } from './onchain.js';

const app = express();
app.use(cors());
app.use(express.json());

// ─── In-memory state (replaced by on-chain reads in production) ──────

let currentVaultState: VaultState = {
  baseBalance: 100_000, // $100,000 USDC
  positions: {},
  mandateRemaining: 50_000, // $50k total budget
  mandatePerTx: 10_000, // $10k per tx cap
  maxPositionBps: 3000, // 30% per name
  maxClusterBps: 6000, // 60% cluster cap
};

interface CycleRecord {
  id: number;
  timestamp: number;
  plan: any;
  executed: boolean;
}

const cycleHistory: CycleRecord[] = [];

// ─── Routes ──────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    network: SUI_NETWORK,
    llm: LLM_API_KEY ? `${LLM_MODEL} (key set)` : 'no key (heuristic mode)',
    package: PACKAGE_ID,
    mandateId: MANDATE_ID,
    vaultId: VAULT_ID,
    memoryStore: MEMORY_STORE_ID,
    agent: getAgentAddress(),
    onchain: MANDATE_ID !== '0x0' && VAULT_ID !== '0x0',
  });
});

// Run the full 6-phase agent reasoning loop
app.post('/api/plan', async (_req, res) => {
  try {
    const plan = await runAgentPlan(
      currentVaultState,
      MANDATE_ID,
      'agent_address_placeholder',
    );

    const record: CycleRecord = {
      id: cycleHistory.length + 1,
      timestamp: Date.now(),
      plan,
      executed: false,
    };
    cycleHistory.push(record);

    res.json({
      cycleId: record.id,
      summary: plan.summary,
      steps: plan.steps,
      trades: plan.trades,
      targetAllocation: plan.targetAllocation,
      walrus: {
        blobId: plan.walrusBlobId,
        hash: plan.walrusHash,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Execute approved trades (simulated for demo, on-chain in production)
app.post('/api/execute', (req, res) => {
  const { cycleId } = req.body;
  const record = cycleHistory.find(c => c.id === cycleId);
  if (!record) return res.status(404).json({ error: 'Cycle not found' });
  if (record.executed) return res.status(400).json({ error: 'Already executed' });

  const approvedTrades = record.plan.trades.filter((t: any) => t.approved);
  const results: any[] = [];

  for (const trade of approvedTrades) {
    if (trade.action === 'buy') {
      // Check mandate cap
      if (trade.amountBase > currentVaultState.mandateRemaining) {
        results.push({ ...trade, success: false, revert: 'MandateCapExceeded' });
        continue;
      }
      // Check per-tx cap
      if (trade.amountBase > currentVaultState.mandatePerTx) {
        results.push({ ...trade, success: false, revert: 'PerTxCapExceeded' });
        continue;
      }
      // Execute
      currentVaultState.baseBalance -= trade.amountBase;
      currentVaultState.positions[trade.asset] = (currentVaultState.positions[trade.asset] ?? 0) + trade.amountBase;
      currentVaultState.mandateRemaining -= trade.amountBase;
      results.push({ ...trade, success: true, revert: null });
    } else {
      // Sell
      const held = currentVaultState.positions[trade.asset] ?? 0;
      const sellAmount = Math.min(trade.amountBase, held);
      currentVaultState.positions[trade.asset] = held - sellAmount;
      currentVaultState.baseBalance += sellAmount;
      results.push({ ...trade, success: true, revert: null });
    }
  }

  record.executed = true;
  res.json({
    cycleId,
    executed: results.length,
    results,
    vaultState: currentVaultState,
  });
});

// List all reasoning cycles
app.get('/api/memory', (_req, res) => {
  res.json(cycleHistory.map(c => ({
    id: c.id,
    timestamp: c.timestamp,
    executed: c.executed,
    walrusBlobId: c.plan.walrusBlobId,
    summary: c.plan.summary,
    targetAllocation: c.plan.targetAllocation,
  })));
});

// Retrieve a specific reasoning chain from Walrus
app.get('/api/memory/:blobId', async (req, res) => {
  const data = await retrieveReasoningChain(req.params.blobId);
  if (!data) return res.status(404).json({ error: 'Blob not found or Walrus unavailable' });
  res.json(data);
});

// Current vault state
app.get('/api/vault', (_req, res) => {
  const totalValue = currentVaultState.baseBalance + Object.values(currentVaultState.positions).reduce((a, b) => a + b, 0);
  res.json({
    ...currentVaultState,
    totalValue,
    positionPcts: Object.fromEntries(
      Object.entries(currentVaultState.positions).map(([k, v]) => [k, totalValue > 0 ? ((v / totalValue) * 100).toFixed(1) + '%' : '0%'])
    ),
  });
});

// Reset vault (for demo)
app.post('/api/reset', (_req, res) => {
  currentVaultState = {
    baseBalance: 100_000,
    positions: {},
    mandateRemaining: 50_000,
    mandatePerTx: 10_000,
    maxPositionBps: 3000,
    maxClusterBps: 6000,
  };
  cycleHistory.length = 0;
  res.json({ status: 'reset', vault: currentVaultState });
});

// --- On-chain execution (real PTBs through mandate enforcement) ---

// Execute a real mandated trade on-chain
app.post('/api/onchain/execute', async (req, res) => {
  const { asset, amount } = req.body;
  if (!asset || !amount) {
    return res.status(400).json({ error: 'asset and amount are required' });
  }

  const result = await executeMandatedBuy(asset, amount);
  res.json(result);
});

// Read real on-chain vault state
app.get('/api/onchain/vault', async (_req, res) => {
  const state = await readVaultOnChain();
  if (!state) return res.json({ error: 'Vault not configured or not found', configured: false });
  res.json({ ...state, configured: true });
});

// Read real on-chain mandate state
app.get('/api/onchain/mandate', async (_req, res) => {
  const state = await readMandateOnChain();
  if (!state) return res.json({ error: 'Mandate not configured or not found', configured: false });
  res.json({ ...state, configured: true });
});

// Get agent info (address, balance)
app.get('/api/onchain/agent', async (_req, res) => {
  const address = getAgentAddress();
  const balance = address ? await getAgentBalance() : 0;
  res.json({
    address,
    balance,
    balanceSUI: (balance / 1_000_000_000).toFixed(4),
    configured: !!address,
  });
});

// Full pipeline: run agent reasoning + execute approved trades on-chain
app.post('/api/onchain/cycle', async (_req, res) => {
  try {
    // 1. Run reasoning
    const plan = await runAgentPlan(currentVaultState, MANDATE_ID, getAgentAddress() || 'none');

    const record: CycleRecord = {
      id: cycleHistory.length + 1,
      timestamp: Date.now(),
      plan,
      executed: false,
    };
    cycleHistory.push(record);

    // 2. Execute approved trades on-chain
    const approvedTrades = plan.trades.filter(t => t.approved);
    const onChainResults: any[] = [];

    for (const trade of approvedTrades) {
      if (trade.action === 'buy') {
        // Convert amount to MIST (for SUI) or appropriate denomination
        const amountMist = trade.amountBase * 1_000_000; // treat amountBase as "micro" units
        const result = await executeMandatedBuy(trade.asset, amountMist);
        onChainResults.push({
          trade: { action: trade.action, asset: trade.asset, amount: trade.amountBase },
          onchain: result,
        });

        // Update local state to reflect
        if (result.success) {
          currentVaultState.baseBalance -= trade.amountBase;
          currentVaultState.positions[trade.asset] = (currentVaultState.positions[trade.asset] ?? 0) + trade.amountBase;
          currentVaultState.mandateRemaining -= trade.amountBase;
        }
      }
    }

    record.executed = onChainResults.some(r => r.onchain.success);

    res.json({
      cycleId: record.id,
      summary: plan.summary,
      steps: plan.steps,
      walrus: { blobId: plan.walrusBlobId, hash: plan.walrusHash },
      onChainResults,
      tradesAttempted: approvedTrades.length,
      tradesSucceeded: onChainResults.filter(r => r.onchain.success).length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ───────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🧠 Mandate Memory Agent running on http://localhost:${PORT}`);
  console.log(`   Network: ${SUI_NETWORK}`);
  console.log(`   LLM: ${LLM_API_KEY ? LLM_MODEL : '⚠️ NO KEY (heuristic fallback)'}`);
  console.log(`   Walrus: publisher configured`);
  console.log(`   Vault: $${currentVaultState.baseBalance.toLocaleString()} USDC\n`);
});

export default app;
