import 'dotenv/config';

// ─── Sui Configuration ───────────────────────────────────────────────

export const SUI_NETWORK = process.env.SUI_NETWORK || 'testnet';
export const SUI_RPC_URL = process.env.SUI_RPC_URL || 'https://fullnode.testnet.sui.io:443';

// Package ID deployed on testnet (set after `sui client publish`)
export const PACKAGE_ID = process.env.PACKAGE_ID || '0x0';

// Object IDs (set after deployment)
export const MANDATE_ID = process.env.MANDATE_ID || '0x0';
export const VAULT_ID = process.env.VAULT_ID || '0x0';
export const MEMORY_STORE_ID = process.env.MEMORY_STORE_ID || '0x0';

// Agent keypair (base64 encoded private key)
export const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || '';
export const OWNER_ADDRESS = process.env.OWNER_ADDRESS || '';

// ─── Walrus Configuration ────────────────────────────────────────────

export const WALRUS_PUBLISHER_URL = process.env.WALRUS_PUBLISHER_URL || 'https://walrus-testnet-publisher.nodes.guru';
export const WALRUS_AGGREGATOR_URL = process.env.WALRUS_AGGREGATOR_URL || 'https://walrus-testnet-aggregator.nodes.guru';

// ─── LLM Configuration ──────────────────────────────────────────────

export const LLM_API_KEY = process.env.GROQ_API_KEY || process.env.LLM_API_KEY || '';
export const LLM_URL = process.env.LLM_URL || 'https://api.groq.com/openai/v1';
export const LLM_MODEL = process.env.LLM_MODEL || 'llama-3.3-70b-versatile';

// ─── Asset Configuration (demo equities as typed addresses) ──────────

export type AssetSymbol = 'SUI' | 'DEEP' | 'WAL' | 'USDC';

// These would be real Coin type addresses on mainnet.
// For demo: use placeholder addresses that the mandate allows.
export const ASSETS: Record<AssetSymbol, string> = {
  SUI: '0x0000000000000000000000000000000000000000000000000000000000000002',
  DEEP: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270',
  WAL: '0x0000000000000000000000000000000000000000000000000000000000000wal',
  USDC: '0x0000000000000000000000000000000000000000000000000000000000usdc',
};

export const TRADABLE_ASSETS: AssetSymbol[] = ['SUI', 'DEEP', 'WAL'];

// ─── Server ──────────────────────────────────────────────────────────

export const PORT = parseInt(process.env.PORT || '3002');
