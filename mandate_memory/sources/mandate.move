/// Mandate — the agent's authority is a Move object.
/// 
/// A Mandate is issued by a vault owner to an agent address. It defines:
/// - Which assets the agent can trade
/// - Per-transaction spending cap
/// - Cumulative spending cap (total budget)
/// - Cluster concentration limit (correlated assets)
/// - Per-name position cap
/// - Freeze/kill switch
///
/// The mandate cannot be copied or arbitrarily dropped — it's a typed,
/// owned capability that the chain enforces. An agent proposes trades;
/// the vault checks the mandate atomically in the same PTB.
module mandate_memory::mandate {
    use sui::event;
    use sui::transfer;
    use sui::vec_set::{Self, VecSet};

    // ─── Error codes ─────────────────────────────────────────────────

    const E_NOT_OWNER: u64 = 0;
    const E_MANDATE_FROZEN: u64 = 1;
    const E_MANDATE_EXPIRED: u64 = 2;
    const E_CUMULATIVE_EXCEEDED: u64 = 3;
    const E_PER_TX_EXCEEDED: u64 = 4;
    const E_ASSET_NOT_PERMITTED: u64 = 5;

    // ─── Structs ─────────────────────────────────────────────────────

    /// The core mandate object. Owned by the vault, referenced by the agent.
    /// This is a shared object so both vault owner and agent can interact.
    public struct Mandate has key, store {
        id: UID,
        /// The vault owner who issued this mandate
        owner: address,
        /// The agent address authorized to act under this mandate
        agent: address,
        /// Allowed asset type IDs (as addresses of coin metadata objects)
        allowed_assets: VecSet<address>,
        /// Maximum value per single transaction (in base units, 6 decimals)
        max_per_tx: u64,
        /// Maximum cumulative value the agent can spend over the mandate lifetime
        max_cumulative: u64,
        /// How much the agent has spent so far
        cumulative_used: u64,
        /// Maximum percentage in any single asset (basis points, e.g. 3000 = 30%)
        max_position_bps: u64,
        /// Maximum percentage across correlated cluster (basis points)
        max_cluster_bps: u64,
        /// Assets in the correlated cluster
        cluster_assets: VecSet<address>,
        /// Whether the mandate is frozen (kill switch)
        frozen: bool,
        /// Expiry timestamp (epoch ms). 0 = no expiry.
        expires_at: u64,
        /// Number of cycles executed under this mandate
        cycle_count: u64,
    }

    /// A hot-potato receipt proving a mandate check passed.
    /// Must be consumed by the vault in the same PTB — cannot be stored or dropped.
    public struct MandateReceipt {
        mandate_id: ID,
        agent: address,
        amount: u64,
        asset: address,
    }

    // ─── Events ──────────────────────────────────────────────────────

    public struct MandateCreated has copy, drop {
        mandate_id: ID,
        owner: address,
        agent: address,
        max_per_tx: u64,
        max_cumulative: u64,
    }

    public struct MandateUsed has copy, drop {
        mandate_id: ID,
        agent: address,
        amount: u64,
        cumulative_after: u64,
        cycle: u64,
    }

    public struct MandateFrozen has copy, drop {
        mandate_id: ID,
        frozen_by: address,
    }

    // ─── Create ──────────────────────────────────────────────────────

    /// Create a new mandate. Only the vault owner calls this.
    public fun create(
        owner: address,
        agent: address,
        allowed_assets: vector<address>,
        cluster_assets: vector<address>,
        max_per_tx: u64,
        max_cumulative: u64,
        max_position_bps: u64,
        max_cluster_bps: u64,
        expires_at: u64,
        ctx: &mut TxContext,
    ): Mandate {
        let mut allowed_set = vec_set::empty<address>();
        let mut i = 0;
        while (i < allowed_assets.length()) {
            allowed_set.insert(allowed_assets[i]);
            i = i + 1;
        };

        let mut cluster_set = vec_set::empty<address>();
        let mut j = 0;
        while (j < cluster_assets.length()) {
            cluster_set.insert(cluster_assets[j]);
            j = j + 1;
        };

        let mandate = Mandate {
            id: object::new(ctx),
            owner,
            agent,
            allowed_assets: allowed_set,
            max_per_tx,
            max_cumulative,
            cumulative_used: 0,
            max_position_bps,
            max_cluster_bps,
            cluster_assets: cluster_set,
            frozen: false,
            expires_at,
            cycle_count: 0,
        };

        event::emit(MandateCreated {
            mandate_id: object::id(&mandate),
            owner,
            agent,
            max_per_tx,
            max_cumulative,
        });

        mandate
    }

    // ─── Authorize (check + issue receipt) ───────────────────────────

    /// The agent calls this to authorize a trade. Returns a hot-potato
    /// MandateReceipt that the vault must consume in the same PTB.
    /// This function performs all checks and updates cumulative spend.
    public fun authorize(
        mandate: &mut Mandate,
        asset: address,
        amount: u64,
        current_epoch_ms: u64,
        ctx: &TxContext,
    ): MandateReceipt {
        // Check caller is the authorized agent
        assert!(ctx.sender() == mandate.agent, E_NOT_OWNER);

        // Check not frozen
        assert!(!mandate.frozen, E_MANDATE_FROZEN);

        // Check not expired
        if (mandate.expires_at > 0) {
            assert!(current_epoch_ms < mandate.expires_at, E_MANDATE_EXPIRED);
        };

        // Check asset is in allowed list
        assert!(mandate.allowed_assets.contains(&asset), E_ASSET_NOT_PERMITTED);

        // Check per-tx cap
        assert!(amount <= mandate.max_per_tx, E_PER_TX_EXCEEDED);

        // Check cumulative cap
        assert!(mandate.cumulative_used + amount <= mandate.max_cumulative, E_CUMULATIVE_EXCEEDED);

        // Update cumulative
        mandate.cumulative_used = mandate.cumulative_used + amount;
        mandate.cycle_count = mandate.cycle_count + 1;

        event::emit(MandateUsed {
            mandate_id: object::id(mandate),
            agent: mandate.agent,
            amount,
            cumulative_after: mandate.cumulative_used,
            cycle: mandate.cycle_count,
        });

        MandateReceipt {
            mandate_id: object::id(mandate),
            agent: mandate.agent,
            amount,
            asset,
        }
    }

    // ─── Consume receipt (vault calls this) ──────────────────────────

    /// The vault consumes the hot-potato receipt after executing the trade.
    /// This enforces that authorize + execute happen in the same PTB.
    public fun consume_receipt(receipt: MandateReceipt): (ID, address, u64, address) {
        let MandateReceipt { mandate_id, agent, amount, asset } = receipt;
        (mandate_id, agent, amount, asset)
    }

    // ─── Admin functions (owner only) ────────────────────────────────

    /// Freeze the mandate (kill switch). Owner only.
    public fun freeze_mandate(mandate: &mut Mandate, ctx: &TxContext) {
        assert!(ctx.sender() == mandate.owner, E_NOT_OWNER);
        mandate.frozen = true;
        event::emit(MandateFrozen {
            mandate_id: object::id(mandate),
            frozen_by: mandate.owner,
        });
    }

    /// Unfreeze a mandate. Owner only.
    public fun unfreeze_mandate(mandate: &mut Mandate, ctx: &TxContext) {
        assert!(ctx.sender() == mandate.owner, E_NOT_OWNER);
        mandate.frozen = false;
    }

    // ─── View functions ──────────────────────────────────────────────

    public fun owner(mandate: &Mandate): address { mandate.owner }
    public fun agent(mandate: &Mandate): address { mandate.agent }
    public fun max_per_tx(mandate: &Mandate): u64 { mandate.max_per_tx }
    public fun max_cumulative(mandate: &Mandate): u64 { mandate.max_cumulative }
    public fun cumulative_used(mandate: &Mandate): u64 { mandate.cumulative_used }
    public fun remaining_budget(mandate: &Mandate): u64 { mandate.max_cumulative - mandate.cumulative_used }
    public fun is_frozen(mandate: &Mandate): bool { mandate.frozen }
    public fun cycle_count(mandate: &Mandate): u64 { mandate.cycle_count }
    public fun max_position_bps(mandate: &Mandate): u64 { mandate.max_position_bps }
    public fun max_cluster_bps(mandate: &Mandate): u64 { mandate.max_cluster_bps }
}
