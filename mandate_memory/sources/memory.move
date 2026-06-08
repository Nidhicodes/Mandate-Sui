/// Memory — on-chain registry of Walrus blob commitments.
///
/// Every agent reasoning cycle produces a full chain-of-thought:
///   perceive → analyze → target → plan → critique → explain
///
/// The reasoning blob is stored on Walrus (encrypted via Seal if needed),
/// and its blob_id + hash is committed on-chain here. This creates a
/// verifiable, tamper-proof audit trail: anyone can verify that the
/// agent's stated reasoning matches what actually preceded a trade.
///
/// This is the Walrus track differentiator: the memory IS the audit trail.
/// An agent's decision history is portable, verifiable, and encrypted —
/// not locked in a database that the agent operator controls.
module mandate_memory::memory {
    use sui::event;
    use std::string::String;

    // ─── Structs ─────────────────────────────────────────────────────

    /// A memory store associated with a mandate. Tracks all reasoning
    /// cycles the agent has committed.
    public struct MemoryStore has key, store {
        id: UID,
        /// The mandate this memory store is linked to
        mandate_id: ID,
        /// The agent who owns these memories
        agent: address,
        /// Number of cycles recorded
        cycle_count: u64,
    }

    /// A single reasoning cycle record committed on-chain.
    /// The full reasoning data lives on Walrus; this is the commitment.
    public struct CycleCommitment has key, store {
        id: UID,
        /// Which memory store this belongs to
        memory_store_id: ID,
        /// Cycle number (sequential)
        cycle_number: u64,
        /// Walrus blob ID where the full reasoning chain is stored
        walrus_blob_id: String,
        /// BLAKE2b-256 hash of the reasoning blob (for integrity verification)
        blob_hash: vector<u8>,
        /// Summary of the market view (short, for on-chain querying)
        market_view_summary: String,
        /// Target allocation as a string representation (e.g., "TSLA:20,AMZN:15")
        target_allocation: String,
        /// Number of trades planned in this cycle
        trades_planned: u64,
        /// Number of trades self-rejected by the Risk Officer
        trades_rejected: u64,
        /// Timestamp when this cycle was committed
        committed_at: u64,
        /// Whether this cycle resulted in actual execution
        executed: bool,
        /// Link to the compliance receipt event (tx digest where trade happened)
        execution_tx: String,
    }

    // ─── Events ──────────────────────────────────────────────────────

    public struct MemoryStoreCreated has copy, drop {
        memory_store_id: ID,
        mandate_id: ID,
        agent: address,
    }

    public struct CycleCommitted has copy, drop {
        memory_store_id: ID,
        cycle_number: u64,
        walrus_blob_id: String,
        blob_hash: vector<u8>,
        trades_planned: u64,
        trades_rejected: u64,
    }

    // ─── Error codes ─────────────────────────────────────────────────

    const E_NOT_AGENT: u64 = 200;

    // ─── Create ──────────────────────────────────────────────────────

    /// Create a memory store for a mandate. Called once when the agent is set up.
    public fun create_store(
        mandate_id: ID,
        agent: address,
        ctx: &mut TxContext,
    ): MemoryStore {
        let store = MemoryStore {
            id: object::new(ctx),
            mandate_id,
            agent,
            cycle_count: 0,
        };

        event::emit(MemoryStoreCreated {
            memory_store_id: object::id(&store),
            mandate_id,
            agent,
        });

        store
    }

    // ─── Commit a reasoning cycle ────────────────────────────────────

    /// Commit a reasoning cycle to the on-chain audit trail.
    /// The agent calls this after storing the full reasoning blob on Walrus.
    /// The blob_hash allows anyone to verify the Walrus data matches.
    public fun commit_cycle(
        store: &mut MemoryStore,
        walrus_blob_id: String,
        blob_hash: vector<u8>,
        market_view_summary: String,
        target_allocation: String,
        trades_planned: u64,
        trades_rejected: u64,
        committed_at: u64,
        ctx: &mut TxContext,
    ): CycleCommitment {
        // Only the agent can commit memories
        assert!(ctx.sender() == store.agent, E_NOT_AGENT);

        store.cycle_count = store.cycle_count + 1;

        let commitment = CycleCommitment {
            id: object::new(ctx),
            memory_store_id: object::id(store),
            cycle_number: store.cycle_count,
            walrus_blob_id,
            blob_hash,
            market_view_summary,
            target_allocation,
            trades_planned,
            trades_rejected,
            committed_at,
            executed: false,
            execution_tx: std::string::utf8(b""),
        };

        event::emit(CycleCommitted {
            memory_store_id: object::id(store),
            cycle_number: store.cycle_count,
            walrus_blob_id: commitment.walrus_blob_id,
            blob_hash: commitment.blob_hash,
            trades_planned,
            trades_rejected,
        });

        commitment
    }

    /// Mark a cycle commitment as executed (link it to the trade tx).
    public fun mark_executed(
        commitment: &mut CycleCommitment,
        execution_tx: String,
        _ctx: &TxContext,
    ) {
        commitment.executed = true;
        commitment.execution_tx = execution_tx;
    }

    // ─── View functions ──────────────────────────────────────────────

    public fun cycle_count(store: &MemoryStore): u64 { store.cycle_count }
    public fun agent(store: &MemoryStore): address { store.agent }
    public fun mandate_id(store: &MemoryStore): ID { store.mandate_id }

    public fun commitment_cycle_number(c: &CycleCommitment): u64 { c.cycle_number }
    public fun commitment_blob_id(c: &CycleCommitment): String { c.walrus_blob_id }
    public fun commitment_executed(c: &CycleCommitment): bool { c.executed }
}
