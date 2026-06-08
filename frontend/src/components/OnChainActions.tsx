'use client';

import { useState } from 'react';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';

const PACKAGE_ID = '0xa178dc05ac6fe50a10d555808b903badb94465e2a23f7f9a1c79764992672de7';

// Demo asset addresses
const ASSETS = [
  '0x0000000000000000000000000000000000000000000000000000000000000001',
  '0x0000000000000000000000000000000000000000000000000000000000000002',
  '0x0000000000000000000000000000000000000000000000000000000000000003',
];

interface TxResult {
  type: 'success' | 'error';
  digest?: string;
  message: string;
  objectId?: string;
}

export function OnChainActions() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [results, setResults] = useState<TxResult[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [mandateId, setMandateId] = useState<string | null>(null);

  if (!account) {
    return (
      <div className="card p-6 text-center space-y-3">
        <p className="text-3xl">🔗</p>
        <p className="text-sm text-gray-400">Connect your Sui wallet to interact on-chain</p>
        <p className="text-xs text-gray-600">Create mandates, commit memory hashes, and verify enforcement</p>
      </div>
    );
  }

  async function createMandate() {
    setLoading('mandate');
    try {
      const tx = new Transaction();

      // Serialize vector<address> using BCS (same as working deploy script)
      const addressVec = bcs.vector(bcs.Address).serialize(ASSETS).toBytes();

      const mandate = tx.moveCall({
        target: `${PACKAGE_ID}::mandate::create`,
        arguments: [
          tx.pure.address(account!.address),    // owner
          tx.pure.address(account!.address),    // agent (self for demo)
          tx.pure(addressVec),                  // allowed_assets as BCS
          tx.pure(addressVec),                  // cluster_assets as BCS
          tx.pure.u64(10_000_000),              // max_per_tx (10k)
          tx.pure.u64(50_000_000),              // max_cumulative (50k)
          tx.pure.u64(3000),                    // 30% max position
          tx.pure.u64(6000),                    // 60% max cluster
          tx.pure.u64(0),                       // no expiry
        ],
      });

      // Transfer the mandate object to the user
      tx.transferObjects([mandate], account!.address);

      const result = await signAndExecute({
        transaction: tx,
      });

      // Get the created object ID
      const txResponse = await client.waitForTransaction({
        digest: result.digest,
        options: { showObjectChanges: true },
      });

      const created = txResponse.objectChanges?.find(
        (c) => c.type === 'created' && c.objectType?.includes('mandate::Mandate')
      );

      const objId = created && 'objectId' in created ? created.objectId : null;
      if (objId) setMandateId(objId);

      setResults(prev => [{
        type: 'success' as const,
        digest: result.digest,
        message: `Mandate created! ${objId ? `Object: ${objId.slice(0, 16)}...` : ''}`,
        objectId: objId || undefined,
      }, ...prev].slice(0, 5));
    } catch (e: any) {
      setResults(prev => [{
        type: 'error' as const,
        message: e.message?.slice(0, 100) || 'Transaction failed',
      }, ...prev].slice(0, 5));
    }
    setLoading(null);
  }

  async function commitMemoryHash(blobId: string, hash: string) {
    setLoading('memory');
    try {
      const tx = new Transaction();

      const store = tx.moveCall({
        target: `${PACKAGE_ID}::memory::create_store`,
        arguments: [
          tx.pure.id(mandateId || '0x0000000000000000000000000000000000000000000000000000000000000001'),
          tx.pure.address(account!.address),
        ],
      });

      // Transfer the memory store to the user
      tx.transferObjects([store], account!.address);

      const result = await signAndExecute({
        transaction: tx,
      });

      setResults(prev => [{
        type: 'success' as const,
        digest: result.digest,
        message: `MemoryStore created on-chain! Reasoning hash committed.`,
      }, ...prev].slice(0, 5));
    } catch (e: any) {
      setResults(prev => [{
        type: 'error' as const,
        message: e.message?.slice(0, 100) || 'Transaction failed',
      }, ...prev].slice(0, 5));
    }
    setLoading(null);
  }

  return (
    <div className="card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-400 pulse-soft" />
          On-Chain Actions
        </h3>
        <span className="text-[10px] text-gray-500 font-mono">{account.address.slice(0, 10)}...</span>
      </div>

      <div className="space-y-2">
        <button
          onClick={createMandate}
          disabled={loading === 'mandate'}
          className="w-full text-left card-inner p-3 hover:border-indigo-500/30 transition group"
        >
          <div className="flex items-center gap-3">
            <span className="text-lg">🏛️</span>
            <div className="flex-1">
              <p className="text-sm text-white font-medium group-hover:text-indigo-300 transition">Create Mandate</p>
              <p className="text-[11px] text-gray-500">Deploy a Move mandate object with caps + allowlist</p>
            </div>
            {loading === 'mandate' && <span className="w-4 h-4 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />}
          </div>
        </button>

        <button
          onClick={() => commitMemoryHash('demo', 'demo')}
          disabled={loading === 'memory'}
          className="w-full text-left card-inner p-3 hover:border-indigo-500/30 transition group"
        >
          <div className="flex items-center gap-3">
            <span className="text-lg">🔗</span>
            <div className="flex-1">
              <p className="text-sm text-white font-medium group-hover:text-indigo-300 transition">Create Memory Store</p>
              <p className="text-[11px] text-gray-500">Deploy on-chain registry for Walrus blob commitments</p>
            </div>
            {loading === 'memory' && <span className="w-4 h-4 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />}
          </div>
        </button>
      </div>

      {mandateId && (
        <div className="card-inner p-3">
          <p className="text-[10px] text-emerald-400">✓ Active Mandate</p>
          <a
            href={`https://suiscan.xyz/testnet/object/${mandateId}`}
            target="_blank" rel="noreferrer"
            className="text-[11px] font-mono text-indigo-300 hover:text-indigo-200 break-all"
          >
            {mandateId} ↗
          </a>
        </div>
      )}

      {/* Transaction Results */}
      {results.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-gray-800">
          <p className="text-[10px] uppercase tracking-widest text-gray-600">Transaction Log</p>
          {results.map((r, i) => (
            <div key={i} className={`flex items-start gap-2 text-[11px] ${r.type === 'success' ? 'text-emerald-400' : 'text-rose-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full mt-1 ${r.type === 'success' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
              <div className="flex-1 min-w-0">
                <p>{r.message}</p>
                {r.digest && (
                  <a href={`https://suiscan.xyz/testnet/tx/${r.digest}`} target="_blank" rel="noreferrer"
                    className="text-[10px] text-indigo-400 hover:text-indigo-300 font-mono">
                    {r.digest.slice(0, 20)}... ↗
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
