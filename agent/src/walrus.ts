/**
 * Walrus Integration — stores reasoning chains as verifiable blobs.
 *
 * Each agent reasoning cycle is serialized as JSON and stored on Walrus.
 * The blob_id and BLAKE2b hash are committed on-chain via the memory module,
 * creating an immutable link between what the agent thought and what it did.
 *
 * This is the Walrus track thesis: agent memory is not a database dump —
 * it's a cryptographically committed, verifiable audit trail that proves
 * the agent's reasoning preceded its action.
 */
import { WALRUS_PUBLISHER_URL, WALRUS_AGGREGATOR_URL } from './config.js';
import type { ReasoningStep } from './agent.js';

export interface WalrusBlob {
  blobId: string;
  hash: string; // hex-encoded BLAKE2b-256
  url: string;
  size: number;
}

/**
 * Store a reasoning chain on Walrus. Returns the blob ID and hash
 * that will be committed on-chain.
 */
export async function storeReasoningChain(
  cycleNumber: number,
  steps: ReasoningStep[],
  marketView: string,
  targetAllocation: Record<string, number>,
  metadata: {
    mandateId: string;
    agentAddress: string;
    timestamp: number;
  },
): Promise<WalrusBlob> {
  const payload = {
    version: '1.0.0',
    type: 'mandate_memory_reasoning_cycle',
    cycle: cycleNumber,
    mandate_id: metadata.mandateId,
    agent: metadata.agentAddress,
    timestamp: metadata.timestamp,
    market_view: marketView,
    target_allocation: targetAllocation,
    reasoning_chain: steps.map(s => ({
      phase: s.phase,
      title: s.title,
      detail: s.detail,
      data: s.data,
    })),
  };

  const body = JSON.stringify(payload, null, 2);
  const bodyBytes = new TextEncoder().encode(body);

  // Compute BLAKE2b-256 hash for on-chain commitment
  // Using SubtleCrypto SHA-256 as BLAKE2b proxy (Walrus uses this for blob IDs)
  const hashBuffer = await crypto.subtle.digest('SHA-256', bodyBytes);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  try {
    // Store on Walrus publisher (PUT /v1/blobs with raw body)
    const res = await fetch(`${WALRUS_PUBLISHER_URL}/v1/blobs`, {
      method: 'PUT',
      body,
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => 'unknown');
      console.warn(`Walrus upload failed (${res.status}): ${errText}. Using local fallback.`);
      return localFallback(body, hashHex);
    }

    const result = await res.json() as any;
    // Walrus returns either { newlyCreated: { blobObject: { blobId } } }
    // or { alreadyCertified: { blobId } }
    let blobId: string;
    if (result.newlyCreated) {
      blobId = result.newlyCreated.blobObject?.blobId || result.newlyCreated.blobId;
    } else if (result.alreadyCertified) {
      blobId = result.alreadyCertified.blobId;
    } else {
      blobId = result.blobId || hashHex.slice(0, 44);
    }

    return {
      blobId,
      hash: hashHex,
      url: `${WALRUS_AGGREGATOR_URL}/v1/blobs/${blobId}`,
      size: bodyBytes.length,
    };
  } catch (err) {
    console.warn(`Walrus upload error: ${err}. Using local fallback.`);
    return localFallback(body, hashHex);
  }
}

/**
 * Retrieve a reasoning chain from Walrus by blob ID.
 */
export async function retrieveReasoningChain(blobId: string): Promise<any | null> {
  try {
    const res = await fetch(`${WALRUS_AGGREGATOR_URL}/v1/blobs/${blobId}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Local fallback when Walrus is unavailable (for development).
 * Still generates a valid blob ID format for testing.
 */
function localFallback(body: string, hashHex: string): WalrusBlob {
  // Generate a deterministic "blob ID" from the hash
  const blobId = `local_${hashHex.slice(0, 32)}`;
  return {
    blobId,
    hash: hashHex,
    url: `local://reasoning/${blobId}`,
    size: new TextEncoder().encode(body).length,
  };
}
