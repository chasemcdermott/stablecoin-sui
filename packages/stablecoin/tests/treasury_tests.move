// Copyright 2024 Circle Internet Financial, LTD. All rights reserved.
//
// SPDX-License-Identifier: Apache-2.0
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

#[test_only]
module stablecoin::treasury_tests {
    use std::string;
    use std::ascii;
    use sui::{
        coin::{Self, Coin, CoinMetadata},
        deny_list::{Self, DenyList},
        event,
        test_scenario::{Self, Scenario}, 
        test_utils::{Self, assert_eq},
    };
    use stablecoin::{
        entry,
        test_utils::last_event_by_type,
        treasury::{Self, MintCap, Treasury}
    };

    // test addresses
    const DEPLOYER: address = @0x0;
    const MASTER_MINTER: address = @0x20;
    const CONTROLLER: address = @0x30;
    const MINTER: address = @0x40;
    const MINT_RECIPIENT: address = @0x50;
    const MINT_CAP_ADDR: address = @0x60;
    const OWNER: address = @0x70;
    const BLOCKLISTER: address = @0x80;
    const PAUSER: address = @0x01;
    const METADATA_UPDATER: address = @0x11;

    const RANDOM_ADDRESS: address = @0x1000;
    const RANDOM_ADDRESS_2: address = @0x1001;

    public struct TREASURY_TESTS has drop {}

    #[test]
    fun e2e_flow__should_succeed_and_pass_all_assertions() {
        // Transaction 1: create coin and treasury
        let mut scenario = setup();

        // Transaction 2: configure mint controller and worker
        scenario.next_tx(MASTER_MINTER);
        test_configure_new_controller(CONTROLLER, MINTER, &mut scenario);

        // Transaction 3: configure minter
        scenario.next_tx(CONTROLLER);
        test_configure_minter(1000000, &mut scenario);

        // Transaction 4: mint to recipient address
        scenario.next_tx(MINTER);
        test_mint(1000000, MINT_RECIPIENT, &mut scenario);

        // Transaction 5: transfer coin balance to minter to be burnt
        scenario.next_tx(MINT_RECIPIENT);
        {
            let coin = scenario.take_from_sender<Coin<TREASURY_TESTS>>();
            assert_eq(coin::value(&coin), 1000000);
            transfer::public_transfer(coin, MINTER);
        };

        // Transaction 6: burn minted balance
        scenario.next_tx(MINTER);
        test_burn(&mut scenario);

        // Transaction 6: remove minter
        scenario.next_tx(CONTROLLER);
        test_remove_minter(&mut scenario);

        // Transaction 7: remove controller
        scenario.next_tx(MASTER_MINTER);
        test_remove_controller(CONTROLLER, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::ENotMasterMinter)]
    fun create_mint_cap__should_fail_if_not_sent_by_master_minter() {
        let mut scenario = setup();

        scenario.next_tx(RANDOM_ADDRESS);
        {
            let treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();

            let mint_cap = treasury.create_mint_cap(scenario.ctx());
            assert_eq(treasury.mint_allowance(object::id(&mint_cap)), 0);
            transfer::public_transfer(mint_cap, MINTER);

            test_scenario::return_shared(treasury);
        };

        scenario.end();
    }

    #[test]
    fun configure_controller__should_succeed_with_existing_mint_cap() {
        let mut scenario = setup();

        scenario.next_tx(MASTER_MINTER);
        test_configure_new_controller(CONTROLLER, MASTER_MINTER, &mut scenario);

        scenario.next_tx(CONTROLLER);
        test_configure_minter(10, &mut scenario);

        scenario.next_tx(MASTER_MINTER);
        {
            let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();
            let mint_cap = scenario.take_from_sender<MintCap<TREASURY_TESTS>>();

            treasury::configure_controller(&mut treasury, RANDOM_ADDRESS, object::id(&mint_cap), scenario.ctx());
            assert_eq(treasury.get_controllers_for_testing().contains(RANDOM_ADDRESS), true);
            assert_eq(treasury.get_controllers_for_testing().contains(CONTROLLER), true); 
            let mint_cap_id = treasury.get_worker(RANDOM_ADDRESS);
            assert_eq(treasury.get_worker(CONTROLLER), mint_cap_id);
            assert_eq(treasury.mint_allowance(mint_cap_id), 10);

            scenario.return_to_sender(mint_cap);
            test_scenario::return_shared(treasury);
        };

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::EControllerAlreadyConfigured)]
    fun configure_controller__should_fail_with_existing_controller() {
        let mut scenario = setup();

        scenario.next_tx(MASTER_MINTER);
        test_configure_controller(CONTROLLER, object::id_from_address(MINT_CAP_ADDR), &mut scenario);

        // Configure the same controller - expect failure
        scenario.next_tx(MASTER_MINTER);
        test_configure_controller(CONTROLLER, object::id_from_address(MINT_CAP_ADDR), &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::ENotMasterMinter)]
    fun configure_controller__should_fail_if_caller_is_not_master_minter() {
        let mut scenario = setup();

        scenario.next_tx(RANDOM_ADDRESS); 
        {
            let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();
            treasury.configure_controller(RANDOM_ADDRESS, object::id_from_address(MINT_CAP_ADDR), scenario.ctx());
            test_scenario::return_shared(treasury);
        };

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::ENotController)]
    fun remove_controller__should_fail_with_non_controller() {
        let mut scenario = setup();

        scenario.next_tx(MASTER_MINTER);
        test_remove_controller(RANDOM_ADDRESS, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::ENotMasterMinter)]
    fun remove_controller__should_fail_if_not_sent_by_master_minter() {
        let mut scenario = setup();

        scenario.next_tx(RANDOM_ADDRESS);
        test_remove_controller(CONTROLLER, &mut scenario);

        scenario.end();
    }

    #[test]
    fun configure_minter__should_reset_allowance() {
        let mut scenario = setup();

        scenario.next_tx(MASTER_MINTER);
        test_configure_new_controller(CONTROLLER, MINTER, &mut scenario);

        scenario.next_tx(CONTROLLER); 
        test_configure_minter(0, &mut scenario);

        scenario.next_tx(CONTROLLER); 
        test_configure_minter(10, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::ENotController)]
    fun configure_minter__should_fail_from_non_controller() {
        let mut scenario = setup();

        scenario.next_tx(RANDOM_ADDRESS); 
        test_configure_minter(0, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::ENotController)]
    fun remove_minter__should_fail_from_non_controller() {
        let mut scenario = setup();

        scenario.next_tx(RANDOM_ADDRESS); 
        test_remove_minter(&mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::EZeroAmount)]
    fun mint__should_fail_with_zero_amount() {
        let mut scenario = setup();

        scenario.next_tx(MASTER_MINTER);
        test_configure_new_controller(CONTROLLER, MINTER, &mut scenario);

        scenario.next_tx(CONTROLLER);
        test_configure_minter(1000000, &mut scenario);

        scenario.next_tx(MINTER);
        test_mint(0, MINT_RECIPIENT, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::ENotMinter)]
    fun mint__should_fail_from_deauthorized_mint_cap() {
        let mut scenario = setup();

        scenario.next_tx(MASTER_MINTER);
        test_configure_new_controller(CONTROLLER, MINTER, &mut scenario);

        scenario.next_tx(CONTROLLER);
        test_configure_minter(1000000, &mut scenario);

        scenario.next_tx(CONTROLLER);
        test_remove_minter(&mut scenario);

        scenario.next_tx(MINTER);
        test_mint(1000000, MINT_RECIPIENT, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::EInsufficientAllowance)]
    fun mint__should_fail_if_exceed_allowance() {
        let mut scenario = setup();

        scenario.next_tx(MASTER_MINTER);
        test_configure_new_controller(CONTROLLER, MINTER, &mut scenario);

        scenario.next_tx(CONTROLLER);
        test_configure_minter(0, &mut scenario);

        scenario.next_tx(MINTER);
        test_mint(1000000, MINT_RECIPIENT, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::EDeniedAddress)]
    fun mint__should_fail_from_denylisted_sender() {
        let mut scenario = setup();

        scenario.next_tx(MASTER_MINTER);
        test_configure_new_controller(CONTROLLER, MINTER, &mut scenario);

        scenario.next_tx(CONTROLLER);
        test_configure_minter(0, &mut scenario);

        scenario.next_tx(OWNER);
        test_blocklist(MINTER, &mut scenario);

        scenario.next_tx(MINTER);
        test_mint(1000000, MINT_RECIPIENT, &mut scenario);

        scenario.end();
    }
 
    #[test, expected_failure(abort_code = ::stablecoin::treasury::EDeniedAddress)]
    fun mint__should_fail_given_denylisted_recipient() {
        let mut scenario = setup();

        scenario.next_tx(MASTER_MINTER);
        test_configure_new_controller(CONTROLLER, MINTER, &mut scenario);

        scenario.next_tx(CONTROLLER);
        test_configure_minter(0, &mut scenario);

        scenario.next_tx(OWNER);
        test_blocklist(MINT_RECIPIENT, &mut scenario);

        scenario.next_tx(MINTER);
        test_mint(1000000, MINT_RECIPIENT, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::ETreasuryCapNotFound)]
    fun mint__should_fail_if_treasury_cap_not_found() {
        let mut scenario = setup();

        scenario.next_tx(MASTER_MINTER);
        test_configure_new_controller(CONTROLLER, MINTER, &mut scenario);

        scenario.next_tx(MASTER_MINTER);
        remove_treasury_cap(&scenario);

        scenario.next_tx(CONTROLLER);
        test_configure_minter(1000000, &mut scenario);

        scenario.next_tx(MINTER);
        test_mint(1000000, MINT_RECIPIENT, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::ENotMinter)]
    fun burn__should_fail_from_deauthorized_mint_cap() {
        let mut scenario = setup();

        scenario.next_tx(MASTER_MINTER);
        test_configure_new_controller(CONTROLLER, MINTER, &mut scenario);

        scenario.next_tx(CONTROLLER);
        test_configure_minter(1000000, &mut scenario);

        scenario.next_tx(MINTER);
        test_mint(1000000, MINTER, &mut scenario);

        scenario.next_tx(CONTROLLER);
        test_remove_minter(&mut scenario);

        scenario.next_tx(MINTER);
        test_burn(&mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::EDeniedAddress)]
    fun burn__should_fail_from_denylisted_sender() {
        let mut scenario = setup();

        scenario.next_tx(MASTER_MINTER);
        test_configure_new_controller(CONTROLLER, MINTER, &mut scenario);

        scenario.next_tx(CONTROLLER);
        test_configure_minter(1000000, &mut scenario);

        scenario.next_tx(MINTER);
        test_mint(1000000, MINTER, &mut scenario);

        scenario.next_tx(OWNER);
        test_blocklist(MINTER, &mut scenario);

        scenario.next_tx(MINTER);
        test_burn(&mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::EZeroAmount)]
    fun burn__should_fail_with_zero_amount() {
        let mut scenario = setup();

        scenario.next_tx(MASTER_MINTER);
        test_configure_new_controller(CONTROLLER, MINTER, &mut scenario);

        scenario.next_tx(CONTROLLER);
        test_configure_minter(0, &mut scenario);

        scenario.next_tx(MINTER);
        let coin = coin::zero<TREASURY_TESTS>(scenario.ctx());
        transfer::public_transfer(coin, MINTER);

        scenario.next_tx(MINTER);
        test_burn(&mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::ETreasuryCapNotFound)]
    fun burn__should_fail_if_treasury_cap_not_found() {
        let mut scenario = setup();

        scenario.next_tx(MASTER_MINTER);
        test_configure_new_controller(CONTROLLER, MINTER, &mut scenario);

        scenario.next_tx(MASTER_MINTER);
        remove_treasury_cap(&scenario);

        scenario.next_tx(CONTROLLER);
        test_configure_minter(0, &mut scenario);

        scenario.next_tx(MINTER);
        let coin = coin::zero<TREASURY_TESTS>(scenario.ctx());
        transfer::public_transfer(coin, MINTER);

        scenario.next_tx(MINTER);
        test_burn(&mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::ENotBlocklister)]
    fun blocklist__should_fail_if_caller_is_not_blocklister() {
        let mut scenario = setup();

        // Some random address tries to blocklist an address, should fail.
        scenario.next_tx(RANDOM_ADDRESS);
        test_blocklist(RANDOM_ADDRESS_2, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::EDenyCapNotFound)]
    fun blocklist__should_fail_when_deny_cap_is_missing() {
        let mut scenario = setup();

        scenario.next_tx(RANDOM_ADDRESS);
        remove_deny_cap(&scenario);

        scenario.next_tx(OWNER);
        test_blocklist(RANDOM_ADDRESS_2, &mut scenario);

        scenario.end();
    }

    #[test]
    fun blocklist__should_succeed_if_caller_is_blocklister() {
        let mut scenario = setup();

        // Blocklister blocklists an address.
        scenario.next_tx(OWNER);
        test_blocklist(RANDOM_ADDRESS_2, &mut scenario);

        scenario.end();
    }

    #[test]
    fun blocklist__should_be_idempotent() {
        let mut scenario = setup();

        // Blocklister blocklists an address.
        scenario.next_tx(OWNER);
        test_blocklist(RANDOM_ADDRESS_2, &mut scenario);

        // Blocklisting the same address keeps the address in the blocklisted state.
        scenario.next_tx(OWNER);
        test_blocklist(RANDOM_ADDRESS_2, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::ENotBlocklister)]
    fun unblocklist__should_fail_if_caller_is_not_blocklister() {
        let mut scenario = setup();

        // Blocklister blocklists an address.
        scenario.next_tx(OWNER);
        test_blocklist(RANDOM_ADDRESS_2, &mut scenario);

        // Some random address tries to unblocklist the address, should fail.
        scenario.next_tx(RANDOM_ADDRESS);
        test_unblocklist(RANDOM_ADDRESS_2, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::EDenyCapNotFound)]
    fun unblocklist__should_fail_when_deny_cap_is_missing() {
        let mut scenario = setup();

        scenario.next_tx(OWNER);
        test_blocklist(RANDOM_ADDRESS_2, &mut scenario);

        scenario.next_tx(RANDOM_ADDRESS);
        remove_deny_cap(&scenario);

        scenario.next_tx(OWNER);
        test_unblocklist(RANDOM_ADDRESS_2, &mut scenario);

        scenario.end();
    }

    #[test]
    fun unblocklist__should_succeed_if_caller_is_blocklister() {
        let mut scenario = setup();

        // Blocklister blocklists an address.
        scenario.next_tx(OWNER);
        test_blocklist(RANDOM_ADDRESS_2, &mut scenario);

        // Blocklister unblocklists the address.
        scenario.next_tx(OWNER);
        test_unblocklist(RANDOM_ADDRESS_2, &mut scenario);

        scenario.end();
    }

    #[test]
    fun unblocklist__should_be_idempotent() {
        let mut scenario = setup();

        // Blocklister blocklists an address.
        scenario.next_tx(OWNER);
        test_blocklist(RANDOM_ADDRESS_2, &mut scenario);

        // Blocklister unblocklists the address.
        scenario.next_tx(OWNER);
        test_unblocklist(RANDOM_ADDRESS_2, &mut scenario);

        // Unblocklisting the same address keeps the address in the unblocklisted state.
        scenario.next_tx(OWNER);
        test_unblocklist(RANDOM_ADDRESS_2, &mut scenario);

        scenario.end();
    }

    #[test]
    fun update_roles__should_succeed_and_pass_all_assertions() {
        let mut scenario = setup();

        // transfer ownership to the DEPLOYER address
        scenario.next_tx(OWNER);
        test_transfer_ownership(DEPLOYER, &mut scenario);

        scenario.next_tx(DEPLOYER);
        test_accept_ownership(&mut scenario);

        // use the DEPLOYER address to modify the master minter, blocklister, pauser, and metadata updater
        scenario.next_tx(DEPLOYER);
        test_update_master_minter(MASTER_MINTER, &mut scenario);

        scenario.next_tx(DEPLOYER);
        test_update_blocklister(BLOCKLISTER, &mut scenario);

        scenario.next_tx(DEPLOYER);
        test_update_pauser(PAUSER, &mut scenario);

        scenario.next_tx(DEPLOYER);
        test_update_metadata_updater(METADATA_UPDATER, &mut scenario);

        scenario.end();
    }

    #[test]
    fun update_metadata__should_succeed_and_pass_all_assertions() {
        let mut scenario = setup();

        scenario.next_tx(OWNER);
        test_update_metadata(
            string::utf8(b"new name"),
            ascii::string(b"new symbol"),
            string::utf8(b"new description"),
            ascii::string(b"new url"),
            &mut scenario
        );

        // try to unset the URL
        scenario.next_tx(OWNER);
        test_update_metadata(
            string::utf8(b"new name"),
            ascii::string(b"new symbol"),
            string::utf8(b"new description"),
            ascii::string(b""),
            &mut scenario
        );

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::ENotMetadataUpdater)]
    fun update_metadata__should_fail_if_not_metadata_updater() {
        let mut scenario = setup();

        scenario.next_tx(RANDOM_ADDRESS);
        test_update_metadata(
            string::utf8(b"new name"),
            ascii::string(b"new symbol"),
            string::utf8(b"new description"),
            ascii::string(b"new url"),
            &mut scenario
        );

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::ETreasuryCapNotFound)]
    fun update_metadata__should_fail_if_not_treasury_cap_not_found() {
        let mut scenario = setup();

        scenario.next_tx(RANDOM_ADDRESS);
        remove_treasury_cap(&scenario);

        scenario.next_tx(OWNER);
        test_update_metadata(
            string::utf8(b"new name"),
            ascii::string(b"new symbol"),
            string::utf8(b"new description"),
            ascii::string(b"new url"),
            &mut scenario
        );

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::ENotPauser)]
    fun pause__should_fail_when_caller_is_not_pauser() {
        let mut scenario = setup();

        scenario.next_tx(RANDOM_ADDRESS);
        test_pause(&mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::EDenyCapNotFound)]
    fun pause__should_fail_when_deny_cap_is_missing() {
        let mut scenario = setup();

        scenario.next_tx(RANDOM_ADDRESS);
        remove_deny_cap(&scenario);

        scenario.next_tx(OWNER);
        test_pause(&mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::EUnimplemented)]
    fun pause__should_fail_with_unimplemented_error() {
        let mut scenario = setup();

        scenario.next_tx(OWNER);
        test_update_pauser(PAUSER, &mut scenario);

        scenario.next_tx(PAUSER);
        test_pause(&mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::ENotPauser)]
    fun unpause__should_fail_when_caller_is_not_pauser() {
        let mut scenario = setup();

        scenario.next_tx(RANDOM_ADDRESS);
        test_unpause(&mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::EDenyCapNotFound)]
    fun unpause__should_fail_when_deny_cap_is_missing() {
        let mut scenario = setup();

        scenario.next_tx(RANDOM_ADDRESS);
        remove_deny_cap(&scenario);

        scenario.next_tx(OWNER);
        test_unpause(&mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::EUnimplemented)]
    fun unpause__should_fail_with_unimplemented_error() {
        let mut scenario = setup();

        scenario.next_tx(OWNER);
        test_update_pauser(PAUSER, &mut scenario);
        
        scenario.next_tx(PAUSER);
        test_unpause(&mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::ETreasuryCapNotFound)]
    fun total_supply__should_fail_when_treasury_cap_is_missing() {
        let mut scenario = setup();

        scenario.next_tx(RANDOM_ADDRESS);
        remove_treasury_cap(&scenario);
        
        scenario.next_tx(RANDOM_ADDRESS);
        {
            let treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();
            treasury.total_supply();
            test_scenario::return_shared(treasury);
        };

        scenario.end();
    }

    // === Helpers ===

    fun setup(): Scenario {
        let mut scenario = test_scenario::begin(DEPLOYER);
        {
            deny_list::create_for_test(scenario.ctx());
            let otw = test_utils::create_one_time_witness<TREASURY_TESTS>();
            let (treasury_cap, deny_cap, metadata) = coin::create_regulated_currency(
                otw,
                6,
                b"SYMBOL",
                b"NAME",
                b"",
                option::none(),
                scenario.ctx()
            );

            let treasury = treasury::create_treasury(
                treasury_cap,
                deny_cap,
                OWNER,
                MASTER_MINTER,
                OWNER,
                OWNER,
                OWNER,
                scenario.ctx()
            );
            assert_eq(treasury.total_supply(), 0);
            assert_eq(treasury.get_controllers_for_testing().length(), 0);
            assert_eq(treasury.get_mint_allowances_for_testing().length(), 0);
            assert_eq(treasury.roles().owner(), OWNER);
            assert_eq(treasury.roles().master_minter(), MASTER_MINTER);
            assert_eq(treasury.roles().blocklister(), OWNER);
            assert_eq(treasury.roles().pauser(), OWNER);
            assert_eq(treasury.roles().metadata_updater(), OWNER);
            treasury.assert_treasury_cap_exists();
            treasury.assert_deny_cap_exists();

            transfer::public_share_object(metadata);
            transfer::public_share_object(treasury);
        };

        scenario
    }

    fun test_configure_new_controller(controller: address, minter: address, scenario: &mut Scenario) {
        let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();

        treasury::configure_new_controller(&mut treasury, controller, minter, scenario.ctx());
        let mint_cap_id = treasury.get_worker(controller);
        assert_eq(treasury.get_controllers_for_testing().contains(controller), true);
        assert_eq(treasury.mint_allowance(treasury.get_worker(controller)), 0);

        let expected_event1 = treasury::create_mint_cap_created_event<TREASURY_TESTS>(mint_cap_id);
        let expected_event2 = treasury::create_controller_configured_event<TREASURY_TESTS>(controller, mint_cap_id);
        assert_eq(event::num_events(), 2);
        assert_eq(last_event_by_type<treasury::MintCapCreated<TREASURY_TESTS>>(), expected_event1);
        assert_eq(last_event_by_type<treasury::ControllerConfigured<TREASURY_TESTS>>(), expected_event2);

        test_scenario::return_shared(treasury);

        // Check new MintCap has been transferred to minter.
        scenario.next_tx(minter);
        let mint_cap = scenario.take_from_sender<MintCap<TREASURY_TESTS>>();
        assert_eq(object::id(&mint_cap), mint_cap_id);
        scenario.return_to_sender(mint_cap);
    }
    
    fun test_configure_controller(controller: address, mint_cap_id: ID, scenario: &mut Scenario) {
        let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();

        treasury::configure_controller(&mut treasury, controller, mint_cap_id, scenario.ctx());
        assert_eq(treasury.get_controllers_for_testing().contains(controller), true);
        assert_eq(treasury.mint_allowance(treasury.get_worker(controller)), 0);

        let expected_event = treasury::create_controller_configured_event<TREASURY_TESTS>(controller, mint_cap_id);
        assert_eq(event::num_events(), 1);
        assert_eq(last_event_by_type<treasury::ControllerConfigured<TREASURY_TESTS>>(), expected_event);

        test_scenario::return_shared(treasury);
    }
    
    fun test_remove_controller(controller: address, scenario: &mut Scenario) {
        let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();

        treasury::remove_controller(&mut treasury, controller, scenario.ctx());
        assert_eq(treasury.get_controllers_for_testing().contains(controller), false);

        let expected_event = treasury::create_controller_removed_event<TREASURY_TESTS>(controller);
        assert_eq(event::num_events(), 1);
        assert_eq(last_event_by_type<treasury::ControllerRemoved<TREASURY_TESTS>>(), expected_event);

        test_scenario::return_shared(treasury);
    }

    fun test_configure_minter(allowance: u64, scenario: &mut Scenario) {
        let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();
        let deny_list = scenario.take_shared<DenyList>();

        treasury::configure_minter(&mut treasury, &deny_list, allowance, scenario.ctx());

        let mint_cap_id = treasury::get_worker(&treasury, scenario.sender());
        assert_eq(treasury::mint_allowance(&treasury, mint_cap_id), allowance);

        let expected_event = treasury::create_minter_configured_event<TREASURY_TESTS>(scenario.ctx().sender(), mint_cap_id, allowance);
        assert_eq(event::num_events(), 1);
        assert_eq(last_event_by_type<treasury::MinterConfigured<TREASURY_TESTS>>(), expected_event);

        test_scenario::return_shared(treasury);
        test_scenario::return_shared(deny_list);
    }

    fun test_remove_minter(scenario: &mut Scenario) {
        let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();

        treasury::remove_minter(&mut treasury, scenario.ctx());

        let mint_cap_id = treasury::get_worker(&treasury, scenario.sender());
        assert_eq(treasury.mint_allowance(mint_cap_id), 0);  
        assert_eq(treasury.get_mint_allowances_for_testing().contains(mint_cap_id), false);  

        let expected_event = treasury::create_minter_removed_event<TREASURY_TESTS>(scenario.ctx().sender(), mint_cap_id);
        assert_eq(event::num_events(), 1);
        assert_eq(last_event_by_type<treasury::MinterRemoved<TREASURY_TESTS>>(), expected_event);

        test_scenario::return_shared(treasury);
    }

    fun test_mint(mint_amount: u64, recipient: address, scenario: &mut Scenario) {
        let deny_list = scenario.take_shared<DenyList>();
        let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();
        let mint_cap = scenario.take_from_sender<MintCap<TREASURY_TESTS>>();

        let allowance_before = treasury.mint_allowance(object::id(&mint_cap));
        treasury::mint(&mut treasury, &mint_cap, &deny_list, mint_amount, recipient, scenario.ctx());
        assert_eq(treasury.total_supply(), mint_amount);
        assert_eq(treasury.mint_allowance(object::id(&mint_cap)), allowance_before - mint_amount);

        let expected_event = treasury::create_mint_event<TREASURY_TESTS>(object::id(&mint_cap), recipient, mint_amount);
        assert_eq(event::num_events(), 1);
        assert_eq(last_event_by_type<treasury::Mint<TREASURY_TESTS>>(), expected_event);

        scenario.return_to_sender(mint_cap);
        test_scenario::return_shared(treasury);
        test_scenario::return_shared(deny_list);

        // Check new coin has been transferred to the recipient at the end of the previous transaction
        scenario.next_tx(recipient);
        let coin = scenario.take_from_sender<Coin<TREASURY_TESTS>>();
        assert_eq(coin.value(), mint_amount);
        scenario.return_to_sender(coin);
    }

    fun test_burn(scenario: &mut Scenario) {
        let sender = scenario.ctx().sender();
        let deny_list = scenario.take_shared<DenyList>();
        let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();
        let mint_cap = scenario.take_from_sender<MintCap<TREASURY_TESTS>>();
        let coin = scenario.take_from_sender<Coin<TREASURY_TESTS>>();
        let coin_id = object::id(&coin);
        
        let allowance_before = treasury.mint_allowance(object::id(&mint_cap));
        let amount_before = treasury.total_supply();
        let burn_amount = coin.value();
        treasury::burn(&mut treasury, &mint_cap, &deny_list, coin, scenario.ctx());
        assert_eq(treasury.total_supply(), amount_before - burn_amount);
        assert_eq(treasury.mint_allowance(object::id(&mint_cap)), allowance_before);

        let expected_event = treasury::create_burn_event<TREASURY_TESTS>(object::id(&mint_cap), burn_amount);
        assert_eq(event::num_events(), 1);
        assert_eq(last_event_by_type<treasury::Burn<TREASURY_TESTS>>(), expected_event);

        scenario.return_to_sender(mint_cap);
        test_scenario::return_shared(treasury);
        test_scenario::return_shared(deny_list);

        // Check coin ID has been deleted at the end of the previous transaction
        scenario.next_tx(sender);
        assert_eq(scenario.ids_for_sender<Coin<TREASURY_TESTS>>().contains(&coin_id), false);
    }

    fun test_blocklist(addr: address, scenario: &mut Scenario) {
        let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();
        let mut deny_list = scenario.take_shared<DenyList>();

        treasury.blocklist(&mut deny_list, addr, scenario.ctx());
        assert_eq(coin::deny_list_contains<TREASURY_TESTS>(&deny_list, addr), true);

        let expected_event = treasury::create_blocklisted_event<TREASURY_TESTS>(addr);
        assert_eq(event::num_events(), 1);
        assert_eq(last_event_by_type<treasury::Blocklisted<TREASURY_TESTS>>(), expected_event);

        test_scenario::return_shared(deny_list);
        test_scenario::return_shared(treasury);
    }

    fun test_unblocklist(addr: address, scenario: &mut Scenario) {
        let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();
        let mut deny_list = scenario.take_shared<DenyList>();

        treasury.unblocklist(&mut deny_list, addr, scenario.ctx());
        assert_eq(coin::deny_list_contains<TREASURY_TESTS>(&deny_list, addr), false);

        let expected_event = treasury::create_unblocklisted_event<TREASURY_TESTS>(addr);
        assert_eq(event::num_events(), 1);
        assert_eq(last_event_by_type<treasury::Unblocklisted<TREASURY_TESTS>>(), expected_event);

        test_scenario::return_shared(deny_list);
        test_scenario::return_shared(treasury);
    }

    fun test_transfer_ownership(new_owner: address, scenario: &mut Scenario) {
        let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();
        entry::transfer_ownership(&mut treasury, new_owner, scenario.ctx());
        assert_eq(*treasury.roles().pending_owner().borrow(), new_owner);
        test_scenario::return_shared(treasury);
    }

    fun test_accept_ownership(scenario: &mut Scenario) {
        let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();
        let pending_owner = treasury.roles().pending_owner();
        entry::accept_ownership(&mut treasury, scenario.ctx());
        assert_eq(treasury.roles().owner(), *pending_owner.borrow());
        assert_eq(treasury.roles().pending_owner().is_none(), true);
        test_scenario::return_shared(treasury);
    }

    fun test_update_master_minter(new_master_minter: address, scenario: &mut Scenario) {
        let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();
        entry::update_master_minter(&mut treasury, new_master_minter, scenario.ctx());
        assert_eq(treasury.roles().master_minter(), new_master_minter);
        test_scenario::return_shared(treasury);
    }

    fun test_update_blocklister(new_blocklister: address, scenario: &mut Scenario) {
        let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();
        entry::update_blocklister(&mut treasury, new_blocklister, scenario.ctx());
        assert_eq(treasury.roles().blocklister(), new_blocklister);
        test_scenario::return_shared(treasury);
    }

    fun test_update_pauser(new_pauser: address, scenario: &mut Scenario) {
        let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();
        entry::update_pauser(&mut treasury, new_pauser, scenario.ctx());
        assert_eq(treasury.roles().pauser(), new_pauser);
        test_scenario::return_shared(treasury);
    }

    fun test_update_metadata_updater(new_metadata_updater: address, scenario: &mut Scenario) {
        let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();
        entry::update_metadata_updater(&mut treasury, new_metadata_updater, scenario.ctx());
        assert_eq(treasury.roles().metadata_updater(), new_metadata_updater);
        test_scenario::return_shared(treasury);
    }

    fun test_pause(scenario: &mut Scenario) {
        let mut deny_list = scenario.take_shared<DenyList>();
        let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();

        treasury.pause(&mut deny_list, scenario.ctx());
        // TODO(SPG-308): check deny list state

        assert_eq(event::num_events(), 1);
        assert_eq(event::events_by_type<treasury::Pause<TREASURY_TESTS>>().length(), 1);

        test_scenario::return_shared(deny_list);
        test_scenario::return_shared(treasury);
    }

    fun test_unpause(scenario: &mut Scenario) {
        let mut deny_list = scenario.take_shared<DenyList>();
        let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();

        treasury.unpause(&mut deny_list, scenario.ctx());
        // TODO(SPG-308): check deny list state

        assert_eq(event::num_events(), 1);
        assert_eq(event::events_by_type<treasury::Unpause<TREASURY_TESTS>>().length(), 1);

        test_scenario::return_shared(deny_list);
        test_scenario::return_shared(treasury);
    }

    fun test_update_metadata(
        name: string::String,
        symbol: ascii::String,
        description: string::String,
        url: ascii::String,
        scenario: &mut Scenario
    ) {
        let treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();
        let mut metadata = scenario.take_shared<CoinMetadata<TREASURY_TESTS>>();

        treasury.update_metadata(&mut metadata, name, symbol, description, url, scenario.ctx());
        assert_eq(event::num_events(), 0);
        assert_eq(metadata.get_name(), name);
        assert_eq(metadata.get_symbol(), symbol);
        assert_eq(metadata.get_description(), description);
        assert_eq(metadata.get_icon_url().borrow().inner_url(), url);

        test_scenario::return_shared(treasury);
        test_scenario::return_shared(metadata);
    }

    fun remove_treasury_cap(scenario: &Scenario) {
        let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();
            
        let treasury_cap = treasury.remove_treasury_cap_for_testing();
        transfer::public_transfer(treasury_cap, MASTER_MINTER);

        test_scenario::return_shared(treasury);
    }

    fun remove_deny_cap(scenario: &Scenario) {
        let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();
            
        let treasury_cap = treasury.remove_deny_cap_for_testing();
        transfer::public_transfer(treasury_cap, MASTER_MINTER);

        test_scenario::return_shared(treasury);
    }
}
