<div align="center">

# MANDATE MEMORY

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Sui Move](https://img.shields.io/badge/Sui_Move-Testnet-4DA2FF)](https://suiscan.xyz/testnet/object/0xa178dc05ac6fe50a10d555808b903badb94465e2a23f7f9a1c79764992672de7)
[![Walrus](https://img.shields.io/badge/Walrus-Verifiable_Memory-6366F1)](https://walrus-testnet-aggregator.nodes.guru)
[![Tests](https://img.shields.io/badge/Move-6_tests_passing-10B981)](mandate_memory/tests/)
[![Built for](https://img.shields.io/badge/Sui_Overflow-2026_Walrus_Track-818CF8)](https://overflow.sui.io)

**AI agents reason freely. The Move contract enforces. Walrus proves every decision.**

*A multi-agent system that manages DeFi positions under cryptographic mandate enforcement on Sui. Every reasoning cycle is stored as a verifiable blob on Walrus before any trade executes. The agent's authority is a Move object. Violations revert on-chain. The audit trail is cryptographic.*

[Live Demo](#) · [Explorer (Package)](https://suiscan.xyz/testnet/object/0xa178dc05ac6fe50a10d555808b903badb94465e2a23f7f9a1c79764992672de7) · [Proven Trade](https://suiscan.xyz/testnet/tx/HkB9JwLiyZt3QdUimZKowCBVPGoaWYxHA366LJQrFyYz) · [3-min Video](#)

</div>

---

## The thing nobody wants to say out loud

AI agents are going to manage DeFi portfolios. That's happening now. But there are two problems nobody has solved together:

**Problem 1: The guardrails are in the agent's code.** Today's agent wallets put spending limits in Python or TypeScript — code the agent itself controls. A hallucination, a prompt injection, or a simple bug can bypass them. The "enforcement" is a suggestion, not a guarantee.

**Problem 2: Nobody can verify WHY the agent traded.** You see the trade receipt. You never see the reasoning. The agent's decision history lives in a database the operator controls — rewritable, deletable, unverifiable. "Trust us" is not an audit trail.

Existing approaches solve one of these. Nobody solves both:

| Approach | Constraint enforcement | Verifiable reasoning | Cross-session memory |
|----------|:-----:|:-----:|:-----:|
| Agent wallets (Beep, etc.) | ❌ code-level limits | ❌ | ❌ |
| DeFi vaults (Enzyme, dHEDGE) | ✅ smart contract rules | ❌ | ❌ |
| MemWal (standalone) | ❌ | ❌ generic storage | ✅ |
| **Mandate Memory** | ✅ **Move objects + PTBs** | ✅ **Walrus blobs + on-chain hash** | ✅ **cross-cycle persistence** |

We solve all three. And we make them architecturally inseparable — the memory IS the enforcement evidence.

---

## What it does, end to end

```
User deposits SUI into vault + sets mandate (once)
    → Agent perceives live market data (SUI, DEEP, WAL — real prices)
    → Strategist Agent analyzes, forms market view
    → Target allocation set (mandate-bounded by caps)
    → Trade sequence planned (sells before buys)
    → Risk Officer Agent independently reviews (can veto)
    → Full reasoning chain stored on Walrus (blob ID committed on-chain)
    → Approved trades execute via PTB:
        authorize(mandate) → execute_buy(vault) — one atomic transaction
    → Contract checks caps → moves real SUI → emits ComplianceReceipt
    → Invalid trades REVERT with specific errors
```

The defining beat: **the Walrus commitment happens BEFORE execution.** The reasoning is stored, hashed, and committed on-chain before any value moves. This means the audit trail cannot be fabricated retroactively.

---

## Why Sui specifically (the judges asked for this)

This isn't "AI + a Sui wallet bolted on." Every Sui primitive is architecturally necessary:

| Sui Primitive | How it's used | Why it can't be done elsewhere |
|---|---|---|
| **Move Objects** | The mandate IS an owned object (`key + store`, no `copy`). The agent's authority is a typed resource — can't be forged, duplicated, or transferred without owner consent. | EVM: authority is a mapping. Only Sui has object-level ownership with type-system enforcement. |
| **PTBs** | One transaction: `authorize(mandate) → check_caps → execute_buy → emit_receipt`. All atomic, no re-entrancy, composable by construction. | EVM needs multiple internal calls with re-entrancy guards. PTBs compose safely. |
| **Hot-Potato Pattern** | `MandateReceipt` has **no `drop` ability**. If `authorize()` issues it, the vault MUST consume it in the same PTB or the tx fails. Partial enforcement is impossible by construction. | Unique to Move's linear type system. No equivalent in Solidity. |
| **Walrus** | Full reasoning chain (5KB–20KB per cycle) stored as a blob. Hash committed on-chain. Auditor fetches blob, verifies hash, reads the agent's full thought process. | IPFS has no availability guarantee. Arweave is permanent but expensive. Walrus is Sui-native, erasure-coded, verifiable. |

---

## The enforcement layers

Every agent trade is checked atomically in a single PTB:

```mermaid
flowchart LR
    T["Agent proposes trade"] --> L1["1. Asset Allowlist"]
    L1 -->|"AssetNotPermitted"| REVERT["❌ REVERT"]
    L1 -->|pass| L2["2. Per-Tx Cap"]
    L2 -->|"PerTxExceeded"| REVERT
    L2 -->|pass| L3["3. Cumulative Budget"]
    L3 -->|"CumulativeExceeded"| REVERT
    L3 -->|pass| L4["4. Position Cap\n(30% per name)"]
    L4 -->|"PositionLimitExceeded"| REVERT
    L4 -->|pass| L5["5. Cluster Cap\n(60% correlated)"]
    L5 -->|"ClusterExceeded"| REVERT
    L5 -->|pass| L6["6. Kill Switch"]
    L6 -->|"MandateFrozen"| REVERT
    L6 -->|pass| EXEC["✅ Execute + ComplianceReceipt"]
```

The **hot-potato `MandateReceipt`** is the enforcement primitive. The Move type system guarantees: if `authorize()` fires, `consume_receipt()` MUST fire in the same PTB. There is no execution path where the cap was checked but the trade wasn't recorded.

---

## The agentic system — not a chatbot wrapper

This is a genuine multi-agent reasoning loop, not a single LLM prompt.

```mermaid
sequenceDiagram
    participant S as Strategist Agent
    participant R as Risk Officer Agent
    participant W as Walrus
    participant V as Vault (on-chain)
    participant M as Mandate (on-chain)

    Note over S: 1. PERCEIVE — live prices (Binance, SUI/DEEP/WAL)
    S->>S: 2. ANALYZE — form market view + per-asset thesis
    S->>S: 3. TARGET — set allocation (respects caps)
    S->>S: 4. PLAN — sequence trades (sells before buys)
    S->>R: Proposed trades
    R->>R: 5. CRITIQUE — independent risk review
    R-->>S: Approved/vetoed each trade
    S->>W: 6. COMMIT — store full reasoning chain
    W-->>S: blob_id + hash
    Note over S,M: Hash committed on-chain before execution
    S->>M: authorize(amount, asset) → MandateReceipt
    M-->>V: hot-potato receipt
    V->>V: check caps → transfer real SUI
    V-->>S: ComplianceReceipt event emitted
```

| Capability | How it works |
|---|---|
| **Live market data** | Real prices from Binance (SUI $0.75, DEEP $0.017). Momentum and volatility computed from 24h change. `[LIVE]` badge proves it. |
| **Two-agent coordination** | Strategist forms the view; a separate Risk Officer agent independently vets every trade. Different system prompts, different concerns. The Risk Officer can veto. |
| **Cross-cycle memory** | Each cycle is stored on Walrus. The agent references its prior stance, computes allocation drift, and avoids churn. |
| **Self-critique** | The agent rejects its own violating trades *before* the contract does — a competent agent never knowingly submits a bad trade. But if it does, the chain catches it. |
| **Transparent reasoning** | Every phase renders in the UI: perceive → analyze → target → plan → critique → commit. The reasoning chain IS the product. |

---

## Deployed and verified on Sui testnet

| Object | Address | Verified |
|--------|---------|:--------:|
| **Package** (mandate, vault, memory) | [`0xa178dc05...672de7`](https://suiscan.xyz/testnet/object/0xa178dc05ac6fe50a10d555808b903badb94465e2a23f7f9a1c79764992672de7) | ✓ |
| **Mandate** (caps + allowlist + freeze) | [`0x2f9a6a32...6747bf`](https://suiscan.xyz/testnet/object/0x2f9a6a32b4202952c0926e6295bddbd4c6e5d4133ee6d7cd02374555e86747bf) | ✓ |
| **Vault** (holds real SUI) | [`0xb2fa78b6...1b2239`](https://suiscan.xyz/testnet/object/0xb2fa78b6f4508b7c3e22f8f04f4f6640220fc991385a9d2abba92f36ac1b2239) | ✓ |

**Mandated trade proven:** `authorize()` + `execute_buy()` in one PTB → real SUI transferred → `ComplianceReceipt` + `MandateUsed` events → cumulative_used incremented → [`HkB9JwL...`](https://suiscan.xyz/testnet/tx/HkB9JwLiyZt3QdUimZKowCBVPGoaWYxHA366LJQrFyYz)

**Walrus storage proven:** reasoning chains stored as real testnet blobs, retrievable at `https://walrus-testnet-aggregator.nodes.guru/v1/blobs/{id}`.

---

## The Walrus integration is the thesis

Other Walrus submissions will store generic data. Ours stores **mandated financial reasoning** — and makes the storage architecturally inseparable from the enforcement:

1. **Reasoning chain stored BEFORE execution.** The blob exists on Walrus before any value moves. This order is enforced by the code path, not by a comment.

2. **Hash links reasoning to action.** The SHA-256 of the Walrus blob is the on-chain commitment. `hash(walrus_blob) == on_chain_commitment` — independently verifiable by anyone.

3. **Memory prevents churn.** The agent reads its prior Walrus blobs, computes drift, and holds when nothing changed. Cross-cycle memory is on Walrus — portable, not locked to any provider.

4. **The audit trail IS the enforcement evidence.** A compliance officer can reconstruct: *what the agent thought → what it decided → what the mandate allowed → what the chain executed*. Every link is cryptographic.

---

## Run it locally

```bash
git clone https://github.com/Nidhicodes/Mandate-Sui
cd Mandate-Sui

# ── Move contracts ──
cd mandate_memory
sui move build
sui move test            # 6 tests, every enforcement path

# ── Agent backend ──
cd ../agent
npm install
cp .env.example .env     # add GROQ_API_KEY (free tier)
npx tsx src/server.ts    # http://localhost:3002

# ── Frontend ──
cd ../frontend
npm install
npx next dev             # http://localhost:3000
```

Open the dashboard → click **Run Agent Cycle** → watch the 6-phase reasoning chain → click **Execute On-Chain** → verify the transaction on SuiScan → click the Walrus link to view the stored reasoning.

---

## Architecture

```
Mandate-Sui/
├── mandate_memory/                Move package (Sui)
│   ├── sources/
│   │   ├── mandate.move           Agent authority object + hot-potato receipt + kill switch
│   │   ├── vault.move             Asset vault + atomic cap enforcement + ComplianceReceipt
│   │   └── memory.move            Walrus blob registry + cycle commitment linking
│   └── tests/
│       └── mandate_tests.move     6 tests: caps, allowlist, freeze, cumulative
│
├── agent/                          TypeScript agent service
│   └── src/
│       ├── agent.ts               6-phase reasoning loop (Strategist + Risk Officer)
│       ├── onchain.ts             Real PTB construction + execution via Sui SDK
│       ├── walrus.ts              Walrus blob storage + retrieval
│       ├── signals.ts             Live market data (Binance)
│       ├── config.ts              Sui/Walrus/LLM configuration
│       └── server.ts              Express API: plan · execute · onchain · memory
│
├── frontend/                       Next.js + Tailwind + @mysten/dapp-kit
│   └── src/
│       ├── app/page.tsx           Dashboard: reasoning chain, vault, memory timeline
│       └── components/            Wallet connect, on-chain actions, providers
│
└── README.md                       ← you are here
```

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Smart contracts | **Sui Move** | Object ownership, PTB atomicity, hot-potato linear types |
| Agent reasoning | **Groq (Llama 3.3 70B)** | Free tier, fast inference, two-agent system |
| Market data | **Binance** (live SUI/DEEP prices) | Reliable, no rate limiting |
| Verifiable memory | **Walrus** (testnet) | Sui-native, erasure-coded, hash-verifiable blobs |
| On-chain execution | **Sui TypeScript SDK** | PTB construction, Ed25519 signing |
| Frontend | **Next.js · Tailwind · @mysten/dapp-kit** | Wallet connect + reasoning chain UI |
| Deploy | **Vercel (frontend) · Render (agent)** | Free tiers, live today |

---

## What makes this different

| What others build | Why this wins |
|---|---|
| "Store chat history on Walrus" | Our storage IS the enforcement evidence — architecturally coupled, not bolted on |
| AI + a wallet connector | Deep Move integration: hot-potato, object ownership, PTB atomicity |
| Single-agent trading bot | Two-agent system: Strategist proposes, Risk Officer independently vetoes |
| DeFi vault with policy rules | Cross-layer: Move enforcement + Walrus audit trail + AI reasoning |
| Generic agent memory | Domain-specific: *financial reasoning chains* linked to *compliance receipts* |

---

## The honest part

A few things stated plainly, because overclaiming loses:

- **Trades use SUI transfers, not DEX routing.** The vault holds real SUI and the mandate enforcement moves real tokens through real cap checks. In production, `execute_buy` would route through DeepBook. The enforcement logic is identical either way — the contract doesn't know or care what the token represents.
- **Walrus blobs are testnet.** Real uploads, real retrievable blobs, real hashes. The commitment mechanism is proven. Mainnet deployment is identical.
- **The AI can be wrong about allocation.** The LLM might propose a bad trade. That's fine — the contract catches it. The point is that a bad proposal from the AI *cannot* result in a mandate breach, because the chain is the final arbiter.
- **Solo build.** One person, two weeks. The product stands on its technical merit.

---

## Where Mandate Memory fits

| Tool | What it watches | The blind spot |
|---|---|---|
| Agent wallets | spending per-call | no cross-call memory, no audit trail, code-level enforcement only |
| DeFi vault policies | allowed actions | no reasoning transparency, no verifiable "why" |
| MemWal (generic) | agent memory blobs | no financial enforcement coupling, no compliance receipts |
| **Mandate Memory** | **everything, linked** | **—** |

The gap it fills: the agent's reasoning, the mandate's enforcement, and the execution proof are cryptographically linked in one verifiable chain. No trust required.

---

## Requirements

- Sui CLI (1.70+), Node 22+
- For real reasoning: a Groq API key ([free tier](https://console.groq.com))
- For on-chain execution: SUI on testnet (faucet: `sui client faucet`)
- For wallet connect: Sui Wallet, Phantom, or use the built-in burner wallet

## License

MIT

<div align="center">

*Mandate Memory doesn't replace your risk team. It gives them a cryptographic guarantee that no AI — however smart, however compromised — can break the rules they set, and a verifiable record of every decision the agent ever made.*

</div>
