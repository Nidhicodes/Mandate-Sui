/**
 * Deploy script — creates the Mandate, Vault, and MemoryStore objects on testnet.
 * Run once after publishing the Move package.
 * 
 * Usage: npx tsx src/deploy.ts
 */
import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { fromBase64 } from '@mysten/sui/utils';

// ─── Configuration ───────────────────────────────────────────────────

const PACKAGE_ID = process.env.PACKAGE_ID || '0xa27f31f85bfa8713c66a3c2fe553139325f4099c1263faa129be3cc8b3e83610';
const NETWORK = (process.env.SUI_NETWORK || 'testnet') as 'testnet' | 'mainnet' | 'devnet';

// We'll use the active Sui CLI keypair
// For programmatic deploy, set DEPLOYER_PRIVATE_KEY in env
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';

// Agent address (can be same as deployer for demo, or a separate keypair)
const AGENT_ADDRESS = process.env.AGENT_ADDRESS || '';

// Allowed asset addresses (placeholder addresses for demo)
const ALLOWED_ASSETS = [
  '0x0000000000000000000000000000000000000000000000000000000000000001', // SUI placeholder
  '0x0000000000000000000000000000000000000000000000000000000000000002', // DEEP placeholder
  '0x0000000000000000000000000000000000000000000000000000000000000003', // WAL placeholder
];

async function main() {
  console.log('🚀 Deploying Mandate Memory objects to', NETWORK);
  console.log(`   Package: ${PACKAGE_ID}`);

  const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });

  if (!DEPLOYER_KEY) {
    console.log('\n⚠️  No DEPLOYER_PRIVATE_KEY set.');
    console.log('   To deploy programmatically, set DEPLOYER_PRIVATE_KEY (base64 ed25519).');
    console.log('   Alternatively, use the Sui CLI to call the functions directly:\n');
    printCliInstructions();
    return;
  }

  const keypair = Ed25519Keypair.fromSecretKey(fromBase64(DEPLOYER_KEY));
  const ownerAddress = keypair.toSuiAddress();
  const agentAddress = AGENT_ADDRESS || ownerAddress;

  console.log(`   Owner: ${ownerAddress}`);
  console.log(`   Agent: ${agentAddress}\n`);

  // Build transaction that creates all objects in one PTB
  const tx = new Transaction();

  // 1. Create Mandate
  const mandate = tx.moveCall({
    target: `${PACKAGE_ID}::mandate::create`,
    arguments: [
      tx.pure.address(ownerAddress),           // owner
      tx.pure.address(agentAddress),           // agent
      tx.makeMoveVec({ elements: ALLOWED_ASSETS.map(a => tx.pure.address(a)) }), // allowed_assets
      tx.makeMoveVec({ elements: ALLOWED_ASSETS.map(a => tx.pure.address(a)) }), // cluster_assets (all correlated)
      tx.pure.u64(10_000_000),                 // max_per_tx (10k USDC, 6dp)
      tx.pure.u64(50_000_000),                 // max_cumulative (50k total)
      tx.pure.u64(3000),                       // max_position_bps (30%)
      tx.pure.u64(6000),                       // max_cluster_bps (60%)
      tx.pure.u64(0),                          // expires_at (no expiry)
    ],
  });

  // Transfer mandate to owner (it's a shared object pattern — for demo, owner-owned)
  tx.transferObjects([mandate], ownerAddress);

  // Note: Vault creation requires a Coin<T> deposit, which needs a type parameter.
  // For the demo, we'll create just the mandate + memory store.

  // 2. Create MemoryStore (needs the mandate ID — we'll use a placeholder for now)
  // In production, this would reference the actual mandate object ID.

  console.log('   Building transaction...');

  try {
    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true, showObjectChanges: true },
    });

    console.log('\n✅ Transaction executed!');
    console.log(`   Digest: ${result.digest}`);
    console.log(`   Explorer: https://suiscan.xyz/testnet/tx/${result.digest}`);

    if (result.objectChanges) {
      console.log('\n   Created objects:');
      for (const change of result.objectChanges) {
        if (change.type === 'created') {
          console.log(`   - ${change.objectType}: ${change.objectId}`);
        }
      }
    }
  } catch (err: any) {
    console.error('\n❌ Transaction failed:', err.message);
  }
}

function printCliInstructions() {
  const owner = '0xe5fa01a53bbc9b09831cfe816ae55a3b173ff913c79bac1f7059c3bf8f28e962';
  console.log(`# Create a mandate (owner = agent for demo):
sui client call \\
  --package ${PACKAGE_ID} \\
  --module mandate \\
  --function create \\
  --args \\
    ${owner} \\
    ${owner} \\
    '[${ALLOWED_ASSETS.map(a => `"${a}"`).join(',')}]' \\
    '[${ALLOWED_ASSETS.map(a => `"${a}"`).join(',')}]' \\
    10000000 \\
    50000000 \\
    3000 \\
    6000 \\
    0 \\
  --gas-budget 10000000
`);
}

main().catch(console.error);
