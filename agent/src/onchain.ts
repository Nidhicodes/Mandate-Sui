/**
 * On-chain executor — builds and submits real PTBs that flow through
 * the mandate enforcement contracts on Sui testnet.
 *
 * The flow in a single PTB:
 *   1. mandate::authorize() → returns MandateReceipt (hot-potato)
 *   2. vault::execute_buy() → consumes receipt, transfers real SUI, emits ComplianceReceipt
 *
 * If any check fails (cap exceeded, asset not allowed, frozen), the entire PTB reverts.
 * This is real money moving through real enforcement.
 */
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiClient } from '@mysten/sui/client';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { bcs } from '@mysten/sui/bcs';
import { PACKAGE_ID, SUI_RPC_URL, AGENT_PRIVATE_KEY, MANDATE_ID, VAULT_ID } from './config.js';

// ─── Types ───────────────────────────────────────────────────────────

export interface OnChainResult {
  success: boolean;
  digest: string | null;
  error: string | null;
  gasUsed: number;
  events: any[];
}

// ─── Client setup ────────────────────────────────────────────────────

let client: SuiClient | null = null;
let keypair: Ed25519Keypair | null = null;

function getClient(): SuiClient {
  if (!client) {
    client = new SuiClient({ url: SUI_RPC_URL });
  }
  return client;
}

function getKeypair(): Ed25519Keypair | null {
  if (!keypair && AGENT_PRIVATE_KEY) {
    try {
      if (AGENT_PRIVATE_KEY.startsWith('suiprivkey')) {
        const { secretKey } = decodeSuiPrivateKey(AGENT_PRIVATE_KEY);
        keypair = Ed25519Keypair.fromSecretKey(secretKey);
      } else if (AGENT_PRIVATE_KEY.startsWith('0x')) {
        const bytes = Buffer.from(AGENT_PRIVATE_KEY.slice(2), 'hex');
        keypair = Ed25519Keypair.fromSecretKey(bytes);
      } else {
        keypair = Ed25519Keypair.fromSecretKey(Buffer.from(AGENT_PRIVATE_KEY, 'base64'));
      }
    } catch (e) {
      console.warn('Failed to load agent keypair:', e);
      return null;
    }
  }
  return keypair;
}

// ─── Execute a mandated buy on-chain ─────────────────────────────────

/**
 * Builds a PTB that:
 *   1. Calls mandate::authorize (gets hot-potato receipt)
 *   2. Calls vault::execute_buy (consumes receipt, moves real SUI)
 *
 * This is a REAL on-chain transaction. If mandate caps are exceeded, it reverts.
 */
export async function executeMandatedBuy(
  asset: string,
  amount: number, // in MIST (1 SUI = 1_000_000_000 MIST)
): Promise<OnChainResult> {
  const kp = getKeypair();
  if (!kp) {
    return { success: false, digest: null, error: 'No agent keypair configured', gasUsed: 0, events: [] };
  }
  if (MANDATE_ID === '0x0' || VAULT_ID === '0x0') {
    return { success: false, digest: null, error: 'Mandate or Vault not deployed (set MANDATE_ID and VAULT_ID in .env)', gasUsed: 0, events: [] };
  }

  const suiClient = getClient();
  const agentAddress = kp.toSuiAddress();
  const currentTime = Date.now();

  try {
    const tx = new Transaction();
    tx.setSender(agentAddress);

    // Step 1: authorize — checks caps, returns hot-potato MandateReceipt
    const receipt = tx.moveCall({
      target: `${PACKAGE_ID}::mandate::authorize`,
      arguments: [
        tx.object(MANDATE_ID),        // &mut Mandate
        tx.pure.address(asset),       // asset address
        tx.pure.u64(amount),          // amount
        tx.pure.u64(currentTime),     // current_epoch_ms
      ],
    });

    // Step 2: execute_buy — consumes receipt, transfers real coins, emits ComplianceReceipt
    tx.moveCall({
      target: `${PACKAGE_ID}::vault::execute_buy`,
      typeArguments: ['0x2::sui::SUI'],
      arguments: [
        tx.object(VAULT_ID),          // &mut Vault<SUI>
        tx.object(MANDATE_ID),        // &Mandate (for cap checks)
        receipt,                       // MandateReceipt (hot-potato)
        tx.pure.u64(amount),          // amount
        tx.pure.address(asset),       // asset address
        tx.pure.u64(currentTime),     // current_epoch_ms
      ],
    });

    // Sign and execute
    const result = await suiClient.signAndExecuteTransaction({
      signer: kp,
      transaction: tx,
      options: {
        showEffects: true,
        showEvents: true,
      },
    });

    const effects = result.effects;
    const success = effects?.status?.status === 'success';
    const gasUsed = effects?.gasUsed
      ? Number(effects.gasUsed.computationCost) + Number(effects.gasUsed.storageCost) - Number(effects.gasUsed.storageRebate)
      : 0;

    return {
      success,
      digest: result.digest,
      error: success ? null : (effects?.status?.error || 'Transaction failed'),
      gasUsed,
      events: result.events || [],
    };
  } catch (e: any) {
    // Parse revert reasons from the error message
    const msg = e.message || String(e);
    const revertReason = parseRevertReason(msg);
    return {
      success: false,
      digest: null,
      error: revertReason || msg.slice(0, 200),
      gasUsed: 0,
      events: [],
    };
  }
}

// ─── Read vault state from chain ─────────────────────────────────────

export interface OnChainVaultState {
  baseBalance: number;
  totalDeployed: number;
  owner: string;
}

export async function readVaultOnChain(): Promise<OnChainVaultState | null> {
  if (VAULT_ID === '0x0') return null;

  const suiClient = getClient();
  try {
    const obj = await suiClient.getObject({
      id: VAULT_ID,
      options: { showContent: true },
    });

    if (!obj.data?.content || obj.data.content.dataType !== 'moveObject') return null;

    const fields = (obj.data.content as any).fields;
    return {
      baseBalance: Number(fields?.base_balance || 0),
      totalDeployed: Number(fields?.total_deployed || 0),
      owner: fields?.owner || '',
    };
  } catch {
    return null;
  }
}

// ─── Read mandate state from chain ───────────────────────────────────

export interface OnChainMandateState {
  agent: string;
  owner: string;
  cumulativeUsed: number;
  maxCumulative: number;
  maxPerTx: number;
  frozen: boolean;
  cycleCount: number;
}

export async function readMandateOnChain(): Promise<OnChainMandateState | null> {
  if (MANDATE_ID === '0x0') return null;

  const suiClient = getClient();
  try {
    const obj = await suiClient.getObject({
      id: MANDATE_ID,
      options: { showContent: true },
    });

    if (!obj.data?.content || obj.data.content.dataType !== 'moveObject') return null;

    const fields = (obj.data.content as any).fields;
    return {
      agent: fields?.agent || '',
      owner: fields?.owner || '',
      cumulativeUsed: Number(fields?.cumulative_used || 0),
      maxCumulative: Number(fields?.max_cumulative || 0),
      maxPerTx: Number(fields?.max_per_tx || 0),
      frozen: fields?.frozen || false,
      cycleCount: Number(fields?.cycle_count || 0),
    };
  } catch {
    return null;
  }
}

// ─── Get agent address and balance ───────────────────────────────────

export function getAgentAddress(): string | null {
  const kp = getKeypair();
  return kp ? kp.toSuiAddress() : null;
}

export async function getAgentBalance(): Promise<number> {
  const kp = getKeypair();
  if (!kp) return 0;

  const suiClient = getClient();
  try {
    const balance = await suiClient.getBalance({
      owner: kp.toSuiAddress(),
      coinType: '0x2::sui::SUI',
    });
    return Number(balance.totalBalance);
  } catch {
    return 0;
  }
}

// ─── Helper ──────────────────────────────────────────────────────────

function parseRevertReason(msg: string): string | null {
  if (msg.includes('E_ASSET_NOT_PERMITTED') || msg.includes('abort_code: 5'))
    return 'AssetNotPermitted — asset is not in the mandate allowlist';
  if (msg.includes('E_PER_TX_EXCEEDED') || msg.includes('abort_code: 4'))
    return 'PerTxExceeded — amount exceeds per-transaction mandate cap';
  if (msg.includes('E_CUMULATIVE_EXCEEDED') || msg.includes('abort_code: 3'))
    return 'CumulativeExceeded — mandate cumulative budget exhausted';
  if (msg.includes('E_MANDATE_FROZEN') || msg.includes('abort_code: 1'))
    return 'MandateFrozen — mandate has been frozen by the owner';
  if (msg.includes('E_POSITION_LIMIT_EXCEEDED') || msg.includes('abort_code: 101'))
    return 'PositionLimitExceeded — would exceed per-name concentration cap';
  if (msg.includes('E_CLUSTER_EXCEEDED') || msg.includes('abort_code: 102'))
    return 'ClusterExceeded — would exceed correlated cluster cap';
  if (msg.includes('E_INSUFFICIENT_BALANCE') || msg.includes('abort_code: 103'))
    return 'InsufficientBalance — vault does not have enough base balance';
  return null;
}
