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
module stablecoin::owner_tests {
    use sui::{
        coin::{Self},
        test_scenario::{Self, Scenario},
        test_utils::{Self, assert_eq},
    };
    use stablecoin::owner::{Self, OwnerService, BlocklisterService, PauserService};
    use stablecoin::owner::{ENotOwner, EPendingOwnerNotSet, ENotPendingOwner, ESamePendingOwner, ESameBlocklister, ESamePauser};

    // test addresses
    const DEPLOYER: address = @0x0;
    const OWNER: address = @0x20;
    const BLOCKLISTER: address = @0x30;
    const PAUSER: address = @0x40;
    const RANDOM_ADDRESS: address = @0x50;
    const TREASURY_CAP_ADMIN: address = @0x60;

    public struct OWNER_TESTS has drop {}

    #[test]
    fun transfer_ownership_and_update_roles__should_succeed_and_pass_all_assertions() {
        let mut scenario = setup();

        // transfer ownership to the DEPLOYER address
        scenario.next_tx(OWNER);
        test_transfer_ownership(OWNER, DEPLOYER, &mut scenario);

        scenario.next_tx(DEPLOYER);
        test_accept_ownership(DEPLOYER, &mut scenario);

        // use the DEPLOYER address to modify the blocklister and pauser
        scenario.next_tx(DEPLOYER);
        test_update_blocklister(BLOCKLISTER, &mut scenario);

        scenario.next_tx(DEPLOYER);
        test_update_pauser(PAUSER, &mut scenario);

        scenario.end();
    }

    #[test]
    fun transfer_ownership__change_pending_owner() {
        let mut scenario = setup();

        // make RANDOM_ADDRESS the pending owner
        scenario.next_tx(OWNER);
        test_transfer_ownership(OWNER, RANDOM_ADDRESS, &mut scenario);

        // make DEPLOYER the pending owner
        scenario.next_tx(OWNER);
        test_transfer_ownership(OWNER, DEPLOYER, &mut scenario);

        // accept DEPLOYER as new owner
        scenario.next_tx(DEPLOYER);
        test_accept_ownership(DEPLOYER, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ENotOwner)]
    fun transfer_ownership__should_fail_if_not_sent_by_owner() {
        let mut scenario = setup();

        scenario.next_tx(RANDOM_ADDRESS);
        test_transfer_ownership(OWNER, RANDOM_ADDRESS, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ESamePendingOwner)]
    fun transfer_ownership__should_fail_if_same_pending_owner() {
        let mut scenario = setup();

        // we should be able to set the pending owner initially
        scenario.next_tx(OWNER);
        test_transfer_ownership(OWNER, BLOCKLISTER, &mut scenario);

        // expect the second to fail, once the pending owner is already set
        scenario.next_tx(OWNER);
        test_transfer_ownership(OWNER, BLOCKLISTER, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = EPendingOwnerNotSet)]
    fun accept_ownership__should_fail_if_pending_owner_not_set() {
        let mut scenario = setup();

        scenario.next_tx(OWNER);
        test_accept_ownership(OWNER, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ENotPendingOwner)]
    fun accept_ownership__should_fail_if_sender_is_not_pending_owner() {
        let mut scenario = setup();

        scenario.next_tx(OWNER);
        test_transfer_ownership(OWNER, BLOCKLISTER, &mut scenario);

        scenario.next_tx(RANDOM_ADDRESS);
        test_accept_ownership(RANDOM_ADDRESS, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ENotOwner)]
    fun update_blocklister__should_fail_if_not_sent_by_owner() {
        let mut scenario = setup();

        scenario.next_tx(RANDOM_ADDRESS);
        test_update_blocklister(RANDOM_ADDRESS, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ESameBlocklister)]
    fun update_blocklister__should_fail_if_same_blocklister() {
        let mut scenario = setup();

        // blocklister starts as OWNER, fails to be set to OWNER again
        scenario.next_tx(OWNER);
        test_update_blocklister(OWNER, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ENotOwner)]
    fun update_pauser__should_fail_if_not_sent_by_owner() {
        let mut scenario = setup();

        scenario.next_tx(RANDOM_ADDRESS);
        test_update_pauser(RANDOM_ADDRESS, &mut scenario);

        scenario.end();
    }

    #[test, expected_failure(abort_code = ESamePauser)]
    fun update_pauser__should_fail_if_same_pauser() {
        let mut scenario = setup();

        // pauser starts as OWNER, fails to be set to OWNER again
        scenario.next_tx(OWNER);
        test_update_pauser(OWNER, &mut scenario);

        scenario.end();
    }

    // === Helpers ===

    // Creates an owned coin and assigns all roles initially to OWNER
    fun setup(): Scenario {
        let mut scenario = test_scenario::begin(DEPLOYER);
        {
            let otw = test_utils::create_one_time_witness<OWNER_TESTS>();
            let (treasury_cap, deny_cap, metadata) = coin::create_regulated_currency(
                otw,
                6,
                b"SYMBOL",
                b"NAME",
                b"",
                option::none(),
                scenario.ctx()
            );

            let deny_cap_id = object::id(&deny_cap);
            let (owner_service, blocklist_service, pause_service) = owner::create_owner_service(deny_cap, OWNER, OWNER, OWNER, scenario.ctx());
            assert_eq(owner_service.owner(), OWNER);
            assert_eq(owner_service.pending_owner().is_none(), true);
            assert_eq(pause_service.pauser(), OWNER);
            assert_eq(blocklist_service.blocklister(), OWNER);

            // check that the deny cap is held by the blocklist service
            assert_eq(blocklist_service.get_deny_cap_id_for_testing(), deny_cap_id);

            transfer::public_share_object(owner_service);
            transfer::public_share_object(blocklist_service);
            transfer::public_share_object(pause_service);

            transfer::public_transfer(treasury_cap, TREASURY_CAP_ADMIN);
            transfer::public_share_object(metadata);
        };

        scenario
    }

    fun test_transfer_ownership(expected_old_owner: address, new_owner: address, scenario: &mut Scenario) {
        let mut owner_service = scenario.take_shared<OwnerService<OWNER_TESTS>>();

        owner_service.transfer_ownership(new_owner, scenario.ctx());
        assert_eq(owner_service.owner(), expected_old_owner);
        assert_eq(*option::borrow(&owner_service.pending_owner()), new_owner);

        test_scenario::return_shared(owner_service);
    }

    fun test_accept_ownership(expected_new_owner: address, scenario: &mut Scenario) {
        let mut owner_service = scenario.take_shared<OwnerService<OWNER_TESTS>>();

        owner_service.accept_ownership(scenario.ctx());
        assert_eq(owner_service.owner(), expected_new_owner);
        assert_eq(option::is_none(&owner_service.pending_owner()), true);

        test_scenario::return_shared(owner_service);
    }

    fun test_update_blocklister(new_blocklister: address, scenario: &mut Scenario) {
        let mut blocklist_service = scenario.take_shared<BlocklisterService<OWNER_TESTS>>();
        let owner_service = scenario.take_shared<OwnerService<OWNER_TESTS>>();

        blocklist_service.update_blocklister(&owner_service, new_blocklister, scenario.ctx());
        assert_eq(blocklist_service.blocklister(), new_blocklister);

        test_scenario::return_shared(blocklist_service);
        test_scenario::return_shared(owner_service);
    }

    fun test_update_pauser(new_pauser: address, scenario: &mut Scenario) {
        let mut pause_service = scenario.take_shared<PauserService<OWNER_TESTS>>();
        let owner_service = scenario.take_shared<OwnerService<OWNER_TESTS>>();

        pause_service.update_pauser(&owner_service, new_pauser, scenario.ctx());
        assert_eq(pause_service.pauser(), new_pauser);

        test_scenario::return_shared(pause_service);
        test_scenario::return_shared(owner_service);
    }
}
