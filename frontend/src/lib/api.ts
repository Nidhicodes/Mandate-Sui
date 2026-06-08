const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

export interface ReasoningStep {
  phase: string;
  title: string;
  detail: string;
  data?: any;
}

export interface Trade {
  action: 'buy' | 'sell';
  asset: string;
  amountBase: number;
  rationale: string;
  approved: boolean;
  riskNote: string;
}

export interface PlanResponse {
  cycleId: number;
  summary: string;
  steps: ReasoningStep[];
  trades: Trade[];
  targetAllocation: Record<string, number>;
  walrus: { blobId: string; hash: string };
}

export interface VaultState {
  baseBalance: number;
  positions: Record<string, number>;
  mandateRemaining: number;
  mandatePerTx: number;
  maxPositionBps: number;
  maxClusterBps: number;
  totalValue: number;
  positionPcts: Record<string, string>;
}

export interface ExecuteResponse {
  cycleId: number;
  summary: string;
  steps: ReasoningStep[];
  walrus: { blobId: string; hash: string };
  onChainResults: Array<{
    trade: { action: string; asset: string; amount: number };
    onchain: { success: boolean; digest: string | null; error: string | null; gasUsed: number };
  }>;
  tradesAttempted: number;
  tradesSucceeded: number;
}

export interface MemoryEntry {
  id: number;
  timestamp: number;
  executed: boolean;
  walrusBlobId: string;
  summary: string;
  targetAllocation: Record<string, number>;
}

export async function runPlan(): Promise<PlanResponse> {
  const res = await fetch(`${API_URL}/api/plan`, { method: 'POST' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function executeCycle(cycleId: number): Promise<ExecuteResponse> {
  const res = await fetch(`${API_URL}/api/onchain/cycle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getVault(): Promise<VaultState> {
  const res = await fetch(`${API_URL}/api/vault`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getMemory(): Promise<MemoryEntry[]> {
  const res = await fetch(`${API_URL}/api/memory`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function resetVault(): Promise<void> {
  await fetch(`${API_URL}/api/reset`, { method: 'POST' });
}

export function walrusUrl(blobId: string): string {
  const agg = process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR || 'https://walrus-testnet-aggregator.nodes.guru';
  return `${agg}/v1/blobs/${blobId}`;
}
