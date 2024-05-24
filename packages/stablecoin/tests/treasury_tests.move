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
    use sui::{
        coin::{Self, Coin, DenyCap},
        deny_list::{Self, DenyList},
        test_scenario::{Self, Scenario}, 
        test_utils::{Self, assert_eq},
    };
    use stablecoin::treasury::{Self, MintCap, Treasury};

    // test addresses
    const DEPLOYER: address = @0x0;
    const TREASURY_ADMIN: address = @0x20;
    const CONTROLLER: address = @0x30;
    const MINTER: address = @0x40;
    const MINT_RECIPIENT: address = @0x50;
    const MINT_CAP_ADDR: address = @0x60;
    const RANDOM_ADDRESS: address = @0x70;
    const DENYLIST_ADMIN: address = @0x80;

    public struct TREASURY_TESTS has drop {}

    #[test]
    fun e2e_flow__should_succeed_and_pass_all_assertions() {
        // Transaction 1: create coin and treasury
        let mut scenario = setup();

        // Transaction 2: configure mint controller and worker
        scenario.next_tx(TREASURY_ADMIN);
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
        scenario.next_tx(TREASURY_ADMIN);
        test_remove_controller(CONTROLLER, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::ENotAdmin)]
    fun change_admin__should_fail_if_not_sent_by_admin() {
        let mut scenario = setup();

        scenario.next_tx(RANDOM_ADDRESS);
        test_change_admin(RANDOM_ADDRESS, TREASURY_ADMIN, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::EZeroAddress)]
    fun change_admin__should_fail_if_new_admin_is_zero_address() {
        let mut scenario = setup();

        scenario.next_tx(TREASURY_ADMIN);
        test_change_admin(TREASURY_ADMIN, @0x0, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::ENotPendingAdmin)]
    fun accept_admin__should_fail_if_sender_is_not_pending_admin() {
        let mut scenario = setup();

        scenario.next_tx(TREASURY_ADMIN);
        test_change_admin(TREASURY_ADMIN, CONTROLLER, &mut scenario);

        scenario.next_tx(RANDOM_ADDRESS);
        test_accept_admin(&mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::EPendingAdminNotSet)]
    fun accept_admin__should_fail_if_pending_admin_is_not_set() {
        let mut scenario = setup();

        scenario.next_tx(RANDOM_ADDRESS);
        test_accept_admin(&mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::ENotAdmin)]
    fun create_mint_cap__should_fail_if_not_sent_by_admin() {
        let mut scenario = setup();

        scenario.next_tx(RANDOM_ADDRESS);
        {
            let treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();

            let mint_cap = treasury.create_mint_cap(scenario.ctx());
            assert_eq(treasury.mint_allowance(object::id_address(&mint_cap)), 0);
            transfer::public_transfer(mint_cap, MINTER);

            test_scenario::return_shared(treasury);
        };

        scenario.end();
    }

    #[test]
    fun configure_controller__should_succeed_with_existing_mint_cap() {
        let mut scenario = setup();

        scenario.next_tx(TREASURY_ADMIN);
        test_configure_new_controller(CONTROLLER, TREASURY_ADMIN, &mut scenario);

        scenario.next_tx(CONTROLLER);
        test_configure_minter(10, &mut scenario);

        scenario.next_tx(TREASURY_ADMIN);
        {
            let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();
            let mint_cap = scenario.take_from_sender<MintCap<TREASURY_TESTS>>();

            treasury::configure_controller(&mut treasury, RANDOM_ADDRESS, object::id_address(&mint_cap), scenario.ctx());
            assert_eq(treasury.get_controllers_for_testing().contains(RANDOM_ADDRESS), true);
            assert_eq(treasury.get_controllers_for_testing().contains(CONTROLLER), true); 
            let mint_cap_addr = treasury.get_worker(RANDOM_ADDRESS);
            assert_eq(treasury.get_worker(CONTROLLER), mint_cap_addr);
            assert_eq(treasury.mint_allowance(mint_cap_addr), 10);

            scenario.return_to_sender(mint_cap);
            test_scenario::return_shared(treasury);
        };

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::EControllerAlreadyConfigured)]
    fun configure_controller__should_fail_with_existing_controller() {
        let mut scenario = setup();

        scenario.next_tx(TREASURY_ADMIN);
        test_configure_controller(CONTROLLER, MINT_CAP_ADDR, &mut scenario);

        // Configure the same controller - expect failure
        scenario.next_tx(TREASURY_ADMIN);
        test_configure_controller(CONTROLLER, MINT_CAP_ADDR, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::ENotAdmin)]
    fun configure_controller__should_fail_if_caller_is_not_admin() {
        let mut scenario = setup();

        scenario.next_tx(RANDOM_ADDRESS); 
        {
            let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();
            treasury.configure_controller(RANDOM_ADDRESS, MINT_CAP_ADDR, scenario.ctx());
            test_scenario::return_shared(treasury);
        };

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::EZeroAddress)]
    fun configure_controller__should_fail_if_controller_is_zero_address() {
        let mut scenario = setup();

        scenario.next_tx(TREASURY_ADMIN);
        test_configure_controller(@0x0, MINT_CAP_ADDR, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::ENotController)]
    fun remove_controller__should_fail_with_non_controller() {
        let mut scenario = setup();

        scenario.next_tx(TREASURY_ADMIN);
        test_remove_controller(RANDOM_ADDRESS, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::EZeroAddress)]
    fun remove_controller__should_fail_with_zero_controller() {
        let mut scenario = setup();

        scenario.next_tx(TREASURY_ADMIN);
        test_remove_controller(@0x0, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::ENotAdmin)]
    fun remove_controller__should_fail_if_not_sent_by_admin() {
        let mut scenario = setup();

        scenario.next_tx(RANDOM_ADDRESS);
        test_remove_controller(CONTROLLER, &mut scenario);

        scenario.end();
    }

    #[test]
    fun configure_minter__should_reset_allowance() {
        let mut scenario = setup();

        scenario.next_tx(TREASURY_ADMIN);
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

        scenario.next_tx(TREASURY_ADMIN);
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

        scenario.next_tx(TREASURY_ADMIN);
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

        scenario.next_tx(TREASURY_ADMIN);
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

        scenario.next_tx(TREASURY_ADMIN);
        test_configure_new_controller(CONTROLLER, MINTER, &mut scenario);

        scenario.next_tx(CONTROLLER);
        test_configure_minter(0, &mut scenario);

        scenario.next_tx(DENYLIST_ADMIN);
        test_add_to_deny_list(MINTER, &mut scenario);

        scenario.next_tx(MINTER);
        test_mint(1000000, MINT_RECIPIENT, &mut scenario);

        scenario.end();
    }
 
    #[test, expected_failure(abort_code = ::stablecoin::treasury::EDeniedAddress)]
    fun mint__should_fail_given_denylisted_recipient() {
        let mut scenario = setup();

        scenario.next_tx(TREASURY_ADMIN);
        test_configure_new_controller(CONTROLLER, MINTER, &mut scenario);

        scenario.next_tx(CONTROLLER);
        test_configure_minter(0, &mut scenario);

        scenario.next_tx(DENYLIST_ADMIN);
        test_add_to_deny_list(MINT_RECIPIENT, &mut scenario);

        scenario.next_tx(MINTER);
        test_mint(1000000, MINT_RECIPIENT, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::EZeroAddress)]
    fun mint__should_fail_if_recipient_is_zero_address() {
        let mut scenario = setup();

        scenario.next_tx(TREASURY_ADMIN);
        test_configure_new_controller(CONTROLLER, MINTER, &mut scenario);

        scenario.next_tx(CONTROLLER);
        test_configure_minter(1000000, &mut scenario);

        scenario.next_tx(MINTER);
        test_mint(1000000, @0x0, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::ENotMinter)]
    fun burn__should_fail_from_deauthorized_mint_cap() {
        let mut scenario = setup();

        scenario.next_tx(TREASURY_ADMIN);
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

        scenario.next_tx(TREASURY_ADMIN);
        test_configure_new_controller(CONTROLLER, MINTER, &mut scenario);

        scenario.next_tx(CONTROLLER);
        test_configure_minter(1000000, &mut scenario);

        scenario.next_tx(MINTER);
        test_mint(1000000, MINTER, &mut scenario);

        scenario.next_tx(DENYLIST_ADMIN);
        test_add_to_deny_list(MINTER, &mut scenario);

        scenario.next_tx(MINTER);
        test_burn(&mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ::stablecoin::treasury::EZeroAmount)]
    fun burn__should_fail_with_zero_amount() {
        let mut scenario = setup();

        scenario.next_tx(TREASURY_ADMIN);
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
            let treasury = treasury::create_treasury(treasury_cap, scenario.ctx().sender(), scenario.ctx());
            assert_eq(treasury.total_supply(), 0);
            assert_eq(treasury.get_controllers_for_testing().length(), 0);
            assert_eq(treasury.get_mint_allowances_for_testing().length(), 0);
            assert_eq(treasury.admin(), DEPLOYER);
            assert_eq(option::is_none(&treasury.pending_admin()), true);

            transfer::public_transfer(deny_cap, DENYLIST_ADMIN);
            transfer::public_share_object(metadata);
            transfer::public_share_object(treasury);
        };

        scenario.next_tx(DEPLOYER);
        test_change_admin(DEPLOYER, TREASURY_ADMIN, &mut scenario);

        scenario.next_tx(TREASURY_ADMIN);
        test_accept_admin(&mut scenario);

        scenario
    }

    fun test_change_admin(old_admin: address, new_admin: address, scenario: &mut Scenario) {
        let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();

        treasury::change_admin(&mut treasury, new_admin, scenario.ctx());
        assert_eq(treasury.admin(), old_admin);
        assert_eq(*option::borrow(&treasury.pending_admin()), new_admin);

        test_scenario::return_shared(treasury);
    }

    fun test_accept_admin(scenario: &mut Scenario) {
        let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();

        treasury::accept_admin(&mut treasury, scenario.ctx());
        assert_eq(treasury.admin(), TREASURY_ADMIN);
        assert_eq(option::is_none(&treasury.pending_admin()), true);

        test_scenario::return_shared(treasury);
    }

    fun test_configure_new_controller(controller: address, minter: address, scenario: &mut Scenario) {
        let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();

        treasury::configure_new_controller(&mut treasury, controller, minter, scenario.ctx());
        assert_eq(treasury.get_controllers_for_testing().contains(controller), true);
        assert_eq(treasury.mint_allowance(treasury.get_worker(controller)), 0);
        let mint_cap_addr = treasury.get_worker(controller);

        test_scenario::return_shared(treasury);

        // Check new MintCap has been transferred to minter.
        scenario.next_tx(minter);
        let mint_cap = scenario.take_from_sender<MintCap<TREASURY_TESTS>>();
        assert_eq(object::id_address(&mint_cap), mint_cap_addr);
        scenario.return_to_sender(mint_cap);
    }
    
    fun test_configure_controller(controller: address, mint_cap_addr: address, scenario: &mut Scenario) {
        let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();

        treasury::configure_controller(&mut treasury, controller, mint_cap_addr, scenario.ctx());
        assert_eq(treasury.get_controllers_for_testing().contains(controller), true);
        assert_eq(treasury.mint_allowance(treasury.get_worker(controller)), 0);

        test_scenario::return_shared(treasury);
    }
    
    fun test_remove_controller(controller: address, scenario: &mut Scenario) {
        let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();

        treasury::remove_controller(&mut treasury, controller, scenario.ctx());
        assert_eq(treasury.get_controllers_for_testing().contains(controller), false);

        test_scenario::return_shared(treasury);
    }

    fun test_configure_minter(allowance: u64, scenario: &mut Scenario) {
        let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();

        treasury::configure_minter(&mut treasury, allowance, scenario.ctx());

        let mint_cap_addr = treasury::get_worker(&treasury, scenario.sender());
        assert_eq(treasury::mint_allowance(&treasury, mint_cap_addr), allowance);

        test_scenario::return_shared(treasury);
    }

    fun test_remove_minter(scenario: &mut Scenario) {
        let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();

        treasury::remove_minter(&mut treasury, scenario.ctx());

        let mint_cap_addr = treasury::get_worker(&treasury, scenario.sender());
        assert_eq(treasury.mint_allowance(mint_cap_addr), 0);  
        assert_eq(treasury.get_mint_allowances_for_testing().contains(mint_cap_addr), false);  

        test_scenario::return_shared(treasury);
    }

    fun test_mint(mint_amount: u64, recipient: address, scenario: &mut Scenario) {
        let deny_list = scenario.take_shared<DenyList>();
        let mut treasury = scenario.take_shared<Treasury<TREASURY_TESTS>>();
        let mint_cap = scenario.take_from_sender<MintCap<TREASURY_TESTS>>();

        let allowance_before = treasury.mint_allowance(object::id_address(&mint_cap));
        let amount_before = treasury.total_supply();
        treasury::mint(&mut treasury, &mint_cap, &deny_list, mint_amount, recipient, scenario.ctx());
        assert_eq(treasury.total_supply(), amount_before + mint_amount);
        assert_eq(treasury.mint_allowance(object::id_address(&mint_cap)), allowance_before - mint_amount);

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
        
        let allowance_before = treasury.mint_allowance(object::id_address(&mint_cap));
        let amount_before = treasury.total_supply();
        let burn_amount = coin.value();
        treasury::burn(&mut treasury, &mint_cap, &deny_list, coin, scenario.ctx());
        assert_eq(treasury.total_supply(), amount_before - burn_amount);
        assert_eq(treasury.mint_allowance(object::id_address(&mint_cap)), allowance_before);

        scenario.return_to_sender(mint_cap);
        test_scenario::return_shared(treasury);
        test_scenario::return_shared(deny_list);

        // Check coin ID has been deleted at the end of the previous transaction
        scenario.next_tx(sender);
        assert_eq(scenario.ids_for_sender<Coin<TREASURY_TESTS>>().contains(&coin_id), false);
    }

    fun test_add_to_deny_list(addr: address, scenario: &mut Scenario) {
        let mut deny_list = scenario.take_shared<DenyList>();
        let mut deny_cap = scenario.take_from_sender<DenyCap<TREASURY_TESTS>>();

        coin::deny_list_add(&mut deny_list, &mut deny_cap, addr, scenario.ctx());
        assert_eq(coin::deny_list_contains<TREASURY_TESTS>(&deny_list, addr), true);

        scenario.return_to_sender(deny_cap);
        test_scenario::return_shared(deny_list);
    }
}
