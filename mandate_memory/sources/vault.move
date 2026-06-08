/// Vault — holds assets and enforces position/cluster limits atomically.
///
/// The vault is owned by the user. The agent proposes trades by calling
/// mandate::authorize (gets a hot-potato receipt), then passes it to
/// vault::execute_buy or vault::execute_sell. The vault checks position
/// and cluster caps, executes the trade, and consumes the receipt — all
/// in a single PTB. If any check fails, the entire transaction reverts.
module mandate_memory::vault {
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use sui::event;
    use sui::transfer;
    use sui::vec_map::{Self, VecMap};
    use mandate_memory::mandate::{Self, Mandate, MandateReceipt};

    // ─── Error codes ─────────────────────────────────────────────────

    #[allow(unused_const)]
    const E_NOT_OWNER: u64 = 100;
    const E_POSITION_LIMIT_EXCEEDED: u64 = 101;
    const E_CLUSTER_EXCEEDED: u64 = 102;
    const E_INSUFFICIENT_BALANCE: u64 = 103;

    // ─── Structs ─────────────────────────────────────────────────────

    /// A managed vault that holds a base asset (e.g., USDC) and tracks
    /// equity positions as value records.
    public struct Vault<phantom T> has key, store {
        id: UID,
        /// The vault owner
        owner: address,
        /// Base asset balance (the "cash" the agent trades from)
        base_balance: Balance<T>,
        /// Position values by asset address (tracked in base units for cap checks)
        positions: VecMap<address, u64>,
        /// Total value deployed (sum of all positions)
        total_deployed: u64,
        /// Associated mandate ID
        mandate_id: ID,
    }

    /// Emitted on every successful trade for the on-chain audit trail.
    public struct ComplianceReceipt has copy, drop {
        vault_id: ID,
        mandate_id: ID,
        agent: address,
        asset: address,
        action: u8,       // 0 = BUY, 1 = SELL
        amount: u64,
        position_after: u64,
        cluster_total_after: u64,
        timestamp_ms: u64,
    }

    // ─── Create ──────────────────────────────────────────────────────

    /// Create a new vault with initial base asset deposit.
    public fun create<T>(
        initial_deposit: Coin<T>,
        mandate_id: ID,
        ctx: &mut TxContext,
    ): Vault<T> {
        Vault<T> {
            id: object::new(ctx),
            owner: ctx.sender(),
            base_balance: coin::into_balance(initial_deposit),
            positions: vec_map::empty(),
            total_deployed: 0,
            mandate_id,
        }
    }

    // ─── Execute Buy ─────────────────────────────────────────────────

    /// Execute a buy: deduct from base balance, increase position.
    /// Checks position cap and cluster cap. Consumes the mandate receipt.
    /// The mandate::authorize call must happen in the same PTB before this.
    public fun execute_buy<T>(
        vault: &mut Vault<T>,
        mandate: &Mandate,
        receipt: MandateReceipt,
        amount: u64,
        asset: address,
        current_epoch_ms: u64,
        ctx: &mut TxContext,
    ) {
        // Consume the hot-potato receipt (proves mandate was checked)
        let (_mandate_id, agent, _authorized_amount, _authorized_asset) = mandate::consume_receipt(receipt);

        // Check sufficient base balance
        assert!(balance::value(&vault.base_balance) >= amount, E_INSUFFICIENT_BALANCE);

        // Calculate new position value
        let current_position = get_position(vault, asset);
        let new_position = current_position + amount;
        let total_portfolio = total_value(vault) ; // includes base + all positions

        // Check per-name cap (position / total portfolio in bps)
        let position_bps = if (total_portfolio > 0) {
            (new_position * 10000) / total_portfolio
        } else { 0 };
        assert!(position_bps <= mandate::max_position_bps(mandate), E_POSITION_LIMIT_EXCEEDED);

        // Check cluster cap
        let new_cluster_total = cluster_total_after_buy(vault, mandate, asset, amount);
        let cluster_bps = if (total_portfolio > 0) {
            (new_cluster_total * 10000) / total_portfolio
        } else { 0 };
        assert!(cluster_bps <= mandate::max_cluster_bps(mandate), E_CLUSTER_EXCEEDED);

        // Execute: reduce base, increase position
        // In production this balance goes through DeepBook swap.
        // For the demo: we transfer to a "swap sink" (the agent) as proof of spend.
        // The position tracking records the value for cap enforcement.
        let spent_balance = balance::split(&mut vault.base_balance, amount);
        let spent_coin = coin::from_balance(spent_balance, ctx);
        transfer::public_transfer(spent_coin, agent);

        // Update position tracking
        set_position(vault, asset, new_position);
        vault.total_deployed = vault.total_deployed + amount;

        // Emit compliance receipt
        event::emit(ComplianceReceipt {
            vault_id: object::id(vault),
            mandate_id: vault.mandate_id,
            agent,
            asset,
            action: 0, // BUY
            amount,
            position_after: new_position,
            cluster_total_after: new_cluster_total,
            timestamp_ms: current_epoch_ms,
        });
    }

    // ─── Execute Sell ────────────────────────────────────────────────

    /// Execute a sell: decrease position, increase base balance.
    /// In production, `proceeds` comes from the DEX swap output.
    /// For the demo, the caller passes the proceeds coin directly.
    public fun execute_sell<T>(
        vault: &mut Vault<T>,
        receipt: MandateReceipt,
        proceeds: Coin<T>,
        amount: u64,
        asset: address,
        current_epoch_ms: u64,
    ) {
        let (_mandate_id, agent, _authorized_amount, _authorized_asset) = mandate::consume_receipt(receipt);

        let current_position = get_position(vault, asset);
        assert!(current_position >= amount, E_INSUFFICIENT_BALANCE);

        let new_position = current_position - amount;
        set_position(vault, asset, new_position);
        vault.total_deployed = vault.total_deployed - amount;

        // Credit base balance with proceeds from the swap
        balance::join(&mut vault.base_balance, coin::into_balance(proceeds));

        event::emit(ComplianceReceipt {
            vault_id: object::id(vault),
            mandate_id: vault.mandate_id,
            agent,
            asset,
            action: 1, // SELL
            amount,
            position_after: new_position,
            cluster_total_after: 0, // simplified for sell
            timestamp_ms: current_epoch_ms,
        });
    }

    // ─── View functions ──────────────────────────────────────────────

    public fun owner<T>(vault: &Vault<T>): address { vault.owner }
    public fun base_balance_value<T>(vault: &Vault<T>): u64 { balance::value(&vault.base_balance) }

    public fun total_value<T>(vault: &Vault<T>): u64 {
        balance::value(&vault.base_balance) + vault.total_deployed
    }

    public fun get_position<T>(vault: &Vault<T>, asset: address): u64 {
        if (vec_map::contains(&vault.positions, &asset)) {
            *vec_map::get(&vault.positions, &asset)
        } else {
            0
        }
    }

    // ─── Entry points ──────────────────────────────────────────────────

    /// Create a vault and share it (so both owner and agent can interact).
    entry fun create_and_share<T>(
        initial_deposit: Coin<T>,
        mandate_id: ID,
        ctx: &mut TxContext,
    ) {
        let vault = create(initial_deposit, mandate_id, ctx);
        transfer::public_share_object(vault);
    }

    // ─── Internal helpers ────────────────────────────────────────────

    fun set_position<T>(vault: &mut Vault<T>, asset: address, value: u64) {
        if (vec_map::contains(&vault.positions, &asset)) {
            let pos = vec_map::get_mut(&mut vault.positions, &asset);
            *pos = value;
        } else {
            vec_map::insert(&mut vault.positions, asset, value);
        };
    }

    /// Calculate cluster total if we buy `amount` of `asset`.
    /// Conservative: treats ALL positions as correlated for the demo.
    /// In production: check against mandate.cluster_assets membership.
    fun cluster_total_after_buy<T>(
        vault: &Vault<T>,
        _mandate: &Mandate,
        _buy_asset: address,
        buy_amount: u64,
    ): u64 {
        // Sum all deployed positions + the new buy amount
        vault.total_deployed + buy_amount
    }
}
