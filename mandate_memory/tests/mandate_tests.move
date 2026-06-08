/// Tests for the mandate enforcement module.
/// Verifies: creation, authorization, cap enforcement, freeze/kill switch.
#[test_only]
module mandate_memory::mandate_tests {
    use sui::test_scenario::{Self as ts};
    use mandate_memory::mandate;

    const OWNER: address = @0xA;
    const AGENT: address = @0xB;
    const ASSET_SUI: address = @0x1;
    const ASSET_DEEP: address = @0x2;
    const ASSET_WAL: address = @0x3;
    const ASSET_NOPE: address = @0x99;

    #[test]
    fun test_create_mandate() {
        let mut scenario = ts::begin(OWNER);
        {
            let mandate = mandate::create(
                OWNER,
                AGENT,
                vector[ASSET_SUI, ASSET_DEEP, ASSET_WAL],
                vector[ASSET_SUI, ASSET_DEEP, ASSET_WAL], // all are correlated
                10_000_000, // 10k per tx
                50_000_000, // 50k cumulative
                3000, // 30% max position
                6000, // 60% max cluster
                0, // no expiry
                ts::ctx(&mut scenario),
            );

            assert!(mandate::owner(&mandate) == OWNER);
            assert!(mandate::agent(&mandate) == AGENT);
            assert!(mandate::max_per_tx(&mandate) == 10_000_000);
            assert!(mandate::max_cumulative(&mandate) == 50_000_000);
            assert!(mandate::remaining_budget(&mandate) == 50_000_000);
            assert!(mandate::is_frozen(&mandate) == false);
            assert!(mandate::cycle_count(&mandate) == 0);

            transfer::public_transfer(mandate, OWNER);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_authorize_within_caps() {
        let mut scenario = ts::begin(OWNER);
        let mut mandate;
        {
            mandate = mandate::create(
                OWNER,
                AGENT,
                vector[ASSET_SUI, ASSET_DEEP, ASSET_WAL],
                vector[ASSET_SUI, ASSET_DEEP, ASSET_WAL],
                10_000_000,
                50_000_000,
                3000,
                6000,
                0,
                ts::ctx(&mut scenario),
            );
        };

        // Switch to agent context
        ts::next_tx(&mut scenario, AGENT);
        {
            let receipt = mandate::authorize(
                &mut mandate,
                ASSET_SUI,
                5_000_000, // 5k — within 10k per-tx cap
                1000, // timestamp
                ts::ctx(&mut scenario),
            );

            // Verify state updated
            assert!(mandate::cumulative_used(&mandate) == 5_000_000);
            assert!(mandate::remaining_budget(&mandate) == 45_000_000);
            assert!(mandate::cycle_count(&mandate) == 1);

            // Consume the receipt
            let (_, _, amount, _) = mandate::consume_receipt(receipt);
            assert!(amount == 5_000_000);
        };

        transfer::public_transfer(mandate, OWNER);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = mandate::E_PER_TX_EXCEEDED)]
    fun test_per_tx_cap_reverts() {
        let mut scenario = ts::begin(OWNER);
        let mut mandate;
        {
            mandate = mandate::create(
                OWNER, AGENT,
                vector[ASSET_SUI],
                vector[ASSET_SUI],
                10_000_000, // 10k per tx
                50_000_000, 3000, 6000, 0,
                ts::ctx(&mut scenario),
            );
        };

        ts::next_tx(&mut scenario, AGENT);
        {
            // Try 15k — should revert (> 10k cap)
            let receipt = mandate::authorize(
                &mut mandate, ASSET_SUI, 15_000_000, 1000, ts::ctx(&mut scenario),
            );
            let (_, _, _, _) = mandate::consume_receipt(receipt);
        };

        transfer::public_transfer(mandate, OWNER);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = mandate::E_CUMULATIVE_EXCEEDED)]
    fun test_cumulative_cap_reverts() {
        let mut scenario = ts::begin(OWNER);
        let mut mandate;
        {
            mandate = mandate::create(
                OWNER, AGENT,
                vector[ASSET_SUI],
                vector[ASSET_SUI],
                10_000_000, // 10k per tx
                15_000_000, // only 15k cumulative
                3000, 6000, 0,
                ts::ctx(&mut scenario),
            );
        };

        ts::next_tx(&mut scenario, AGENT);
        {
            // First 10k — fine
            let r1 = mandate::authorize(&mut mandate, ASSET_SUI, 10_000_000, 1000, ts::ctx(&mut scenario));
            let (_, _, _, _) = mandate::consume_receipt(r1);
        };

        ts::next_tx(&mut scenario, AGENT);
        {
            // Second 10k — should fail (total 20k > 15k cumulative)
            let r2 = mandate::authorize(&mut mandate, ASSET_SUI, 10_000_000, 2000, ts::ctx(&mut scenario));
            let (_, _, _, _) = mandate::consume_receipt(r2);
        };

        transfer::public_transfer(mandate, OWNER);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = mandate::E_ASSET_NOT_PERMITTED)]
    fun test_asset_not_permitted_reverts() {
        let mut scenario = ts::begin(OWNER);
        let mut mandate;
        {
            mandate = mandate::create(
                OWNER, AGENT,
                vector[ASSET_SUI, ASSET_DEEP], // only SUI and DEEP allowed
                vector[ASSET_SUI, ASSET_DEEP],
                10_000_000, 50_000_000, 3000, 6000, 0,
                ts::ctx(&mut scenario),
            );
        };

        ts::next_tx(&mut scenario, AGENT);
        {
            // Try to buy ASSET_NOPE — not in the allowlist
            let receipt = mandate::authorize(
                &mut mandate, ASSET_NOPE, 1_000_000, 1000, ts::ctx(&mut scenario),
            );
            let (_, _, _, _) = mandate::consume_receipt(receipt);
        };

        transfer::public_transfer(mandate, OWNER);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = mandate::E_MANDATE_FROZEN)]
    fun test_frozen_mandate_reverts() {
        let mut scenario = ts::begin(OWNER);
        let mut mandate;
        {
            mandate = mandate::create(
                OWNER, AGENT,
                vector[ASSET_SUI],
                vector[ASSET_SUI],
                10_000_000, 50_000_000, 3000, 6000, 0,
                ts::ctx(&mut scenario),
            );
        };

        // Owner freezes the mandate
        ts::next_tx(&mut scenario, OWNER);
        {
            mandate::freeze_mandate(&mut mandate, ts::ctx(&mut scenario));
            assert!(mandate::is_frozen(&mandate) == true);
        };

        // Agent tries to trade — should revert
        ts::next_tx(&mut scenario, AGENT);
        {
            let receipt = mandate::authorize(
                &mut mandate, ASSET_SUI, 1_000_000, 1000, ts::ctx(&mut scenario),
            );
            let (_, _, _, _) = mandate::consume_receipt(receipt);
        };

        transfer::public_transfer(mandate, OWNER);
        ts::end(scenario);
    }
}
