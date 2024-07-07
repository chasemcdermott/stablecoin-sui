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
module stablecoin::roles_tests {
    use sui::{
        event,
        test_scenario::{Self, Scenario},
        test_utils::assert_eq,
        test_utils::destroy,
    };
    use stablecoin::roles::{Self, Roles};
    use stablecoin::test_utils::last_event_by_type;

    public struct ROLES_TEST has drop {}

    // test addresses
    const DEPLOYER: address = @0x0;
    const OWNER: address = @0x20;
    const BLOCKLISTER: address = @0x30;
    const PAUSER: address = @0x40;
    const RANDOM_ADDRESS: address = @0x50;
    const TREASURY_ADMIN: address = @0x60;
    const METADATA_UPDATER: address = @0x70;

    #[test, expected_failure(abort_code = roles::ENotAdmin)]
    fun change_admin__should_fail_if_not_sent_by_admin() {
        let (mut scenario, mut roles) = setup();

        scenario.next_tx(RANDOM_ADDRESS);
        test_change_admin(TREASURY_ADMIN, &mut roles, &mut scenario);

        scenario.end();
        destroy(roles);
    }

    #[test, expected_failure(abort_code = roles::ESamePendingAdmin)]
    fun change_admin__should_fail_if_same_pending_admin() {
        let (mut scenario, mut roles) = setup();

        // we should be able to set the pending admin initially
        scenario.next_tx(TREASURY_ADMIN);
        test_change_admin(RANDOM_ADDRESS, &mut roles, &mut scenario);

        // expect the second to fail, once the pending admin is already set
        scenario.next_tx(TREASURY_ADMIN);
        test_change_admin(RANDOM_ADDRESS, &mut roles, &mut scenario);

        scenario.end();
        destroy(roles);
    }

    #[test, expected_failure(abort_code = roles::ENotPendingAdmin)]
    fun accept_admin__should_fail_if_sender_is_not_pending_admin() {
        let (mut scenario, mut roles) = setup();

        scenario.next_tx(TREASURY_ADMIN);
        test_change_admin(OWNER, &mut roles, &mut scenario);

        scenario.next_tx(RANDOM_ADDRESS);
        test_accept_admin(&mut roles, &mut scenario);

        scenario.end();
        destroy(roles);
    }

    #[test, expected_failure(abort_code = roles::EPendingAdminNotSet)]
    fun accept_admin__should_fail_if_pending_admin_is_not_set() {
        let (mut scenario, mut roles) = setup();

        scenario.next_tx(RANDOM_ADDRESS);
        test_accept_admin(&mut roles, &mut scenario);

        scenario.end();
        destroy(roles);
    }

    #[test]
    fun transfer_ownership_and_update_roles__should_succeed_and_pass_all_assertions() {
        let (mut scenario, mut roles) = setup();

        // transfer ownership to the DEPLOYER address
        scenario.next_tx(OWNER);
        test_transfer_ownership(DEPLOYER, &mut roles, &mut scenario);

        scenario.next_tx(DEPLOYER);
        test_accept_ownership(&mut roles, &mut scenario);

        // use the DEPLOYER address to modify the blocklister, pauser, and metadata updater
        scenario.next_tx(DEPLOYER);
        test_update_blocklister(BLOCKLISTER, &mut roles, &mut scenario);

        scenario.next_tx(DEPLOYER);
        test_update_pauser(PAUSER, &mut roles, &mut scenario);

        scenario.next_tx(DEPLOYER);
        test_update_metadata_updater(METADATA_UPDATER, &mut roles, &mut scenario);

        scenario.end();
        destroy(roles);
    }

    #[test]
    fun transfer_ownership__change_pending_owner() {
        let (mut scenario, mut roles) = setup();

        // make RANDOM_ADDRESS the pending owner
        scenario.next_tx(OWNER);
        test_transfer_ownership(RANDOM_ADDRESS, &mut roles, &mut scenario);

        // make DEPLOYER the pending owner
        scenario.next_tx(OWNER);
        test_transfer_ownership(DEPLOYER, &mut roles, &mut scenario);

        // accept DEPLOYER as new owner
        scenario.next_tx(DEPLOYER);
        test_accept_ownership(&mut roles, &mut scenario);

        scenario.end();
        destroy(roles);
    }

    #[test, expected_failure(abort_code = roles::ENotOwner)]
    fun transfer_ownership__should_fail_if_not_sent_by_owner() {
        let (mut scenario, mut roles) = setup();

        scenario.next_tx(RANDOM_ADDRESS);
        test_transfer_ownership(RANDOM_ADDRESS, &mut roles, &mut scenario);

        scenario.end();
        destroy(roles);
    }

    #[test, expected_failure(abort_code = roles::ESamePendingOwner)]
    fun transfer_ownership__should_fail_if_same_pending_owner() {
        let (mut scenario, mut roles) = setup();

        // we should be able to set the pending owner initially
        scenario.next_tx(OWNER);
        test_transfer_ownership(BLOCKLISTER, &mut roles, &mut scenario);

        // expect the second to fail, once the pending owner is already set
        scenario.next_tx(OWNER);
        test_transfer_ownership(BLOCKLISTER, &mut roles, &mut scenario);

        scenario.end();
        destroy(roles);
    }

    #[test, expected_failure(abort_code = roles::EPendingOwnerNotSet)]
    fun accept_ownership__should_fail_if_pending_owner_not_set() {
        let (mut scenario, mut roles) = setup();

        scenario.next_tx(OWNER);
        test_accept_ownership(&mut roles, &mut scenario);

        scenario.end();
        destroy(roles);
    }

    #[test, expected_failure(abort_code = roles::ENotPendingOwner)]
    fun accept_ownership__should_fail_if_sender_is_not_pending_owner() {
        let (mut scenario, mut roles) = setup();

        scenario.next_tx(OWNER);
        test_transfer_ownership(BLOCKLISTER, &mut roles, &mut scenario);

        scenario.next_tx(RANDOM_ADDRESS);
        test_accept_ownership(&mut roles, &mut scenario);

        scenario.end();
        destroy(roles);
    }

    #[test, expected_failure(abort_code = roles::ENotOwner)]
    fun update_blocklister__should_fail_if_not_sent_by_owner() {
        let (mut scenario, mut roles) = setup();

        scenario.next_tx(RANDOM_ADDRESS);
        test_update_blocklister(RANDOM_ADDRESS, &mut roles, &mut scenario);

        scenario.end();
        destroy(roles);
    }

    #[test, expected_failure(abort_code = roles::ESameBlocklister)]
    fun update_blocklister__should_fail_if_same_blocklister() {
        let (mut scenario, mut roles) = setup();

        // blocklister starts as OWNER, fails to be set to OWNER again
        scenario.next_tx(OWNER);
        test_update_blocklister(OWNER, &mut roles, &mut scenario);

        scenario.end();
        destroy(roles);
    }

    #[test, expected_failure(abort_code = roles::ENotOwner)]
    fun update_pauser__should_fail_if_not_sent_by_owner() {
        let (mut scenario, mut roles) = setup();

        scenario.next_tx(RANDOM_ADDRESS);
        test_update_pauser(RANDOM_ADDRESS, &mut roles, &mut scenario);

        scenario.end();
        destroy(roles);
    }

    #[test, expected_failure(abort_code = roles::ESamePauser)]
    fun update_pauser__should_fail_if_same_pauser() {
        let (mut scenario, mut roles) = setup();

        // pauser starts as OWNER, fails to be set to OWNER again
        scenario.next_tx(OWNER);
        test_update_pauser(OWNER, &mut roles, &mut scenario);

        scenario.end();
        destroy(roles);
    }

    #[test, expected_failure(abort_code = roles::ENotOwner)]
    fun update_metadata_updater__should_fail_if_not_sent_by_owner() {
        let (mut scenario, mut roles) = setup();

        scenario.next_tx(RANDOM_ADDRESS);
        test_update_metadata_updater(RANDOM_ADDRESS, &mut roles, &mut scenario);

        scenario.end();
        destroy(roles);
    }

    #[test, expected_failure(abort_code = roles::ESameMetadataUpdater)]
    fun update_metadata_updater__should_fail_if_same_metadata_updater() {
        let (mut scenario, mut roles) = setup();

        // metadata updater starts as OWNER, fails to be set to OWNER again
        scenario.next_tx(OWNER);
        test_update_metadata_updater(OWNER, &mut roles, &mut scenario);

        scenario.end();
        destroy(roles);
    }

    // === Helpers ===

    /// Creates a Roles object and assigns admin to TREASURY_ADMIN and other roles to OWNER
    fun setup(): (Scenario, Roles<ROLES_TEST>) {
        let scenario = test_scenario::begin(DEPLOYER);
        let roles = roles::create_roles(TREASURY_ADMIN, OWNER, OWNER, OWNER, OWNER);
        assert_eq(roles.admin(), TREASURY_ADMIN);
        assert_eq(roles.pending_admin().is_none(), true);
        assert_eq(roles.owner(), OWNER);
        assert_eq(roles.pending_owner().is_none(), true);
        assert_eq(roles.pauser(), OWNER);
        assert_eq(roles.blocklister(), OWNER);

        (scenario, roles)
    }

    public(package) fun test_change_admin<T>(new_admin: address, roles: &mut Roles<T>, scenario: &mut Scenario) {
        let old_admin = roles.admin();
        roles.change_admin(new_admin, scenario.ctx());

        let expected_event = roles::create_admin_transfer_started_event<T>(old_admin, new_admin);
        assert_eq(event::num_events(), 1);
        assert_eq(last_event_by_type<roles::TreasuryAdminTransferStarted<T>>(), expected_event);
        assert_eq(roles.admin(), old_admin);
        assert_eq(*roles.pending_admin().borrow(), new_admin);
    }

    public(package) fun test_accept_admin<T>(roles: &mut Roles<T>, scenario: &mut Scenario) {
        let old_admin = roles.admin();
        let pending_admin = roles.pending_admin();
        roles.accept_admin(scenario.ctx());

        let expected_new_admin = *pending_admin.borrow();
        let expected_event = roles::create_admin_changed_event<T>(old_admin, expected_new_admin);
        assert_eq(event::num_events(), 1);
        assert_eq(last_event_by_type<roles::TreasuryAdminChanged<T>>(), expected_event);
        assert_eq(roles.admin(), expected_new_admin);
        assert_eq(roles.pending_admin().is_none(), true);
    }

    public(package) fun test_transfer_ownership<T>(new_owner: address, roles: &mut Roles<T>, scenario: &mut Scenario) {
        let old_owner = roles.owner();
        roles.transfer_ownership(new_owner, scenario.ctx());

        let expected_event = roles::create_owner_transfer_started_event<T>(old_owner, new_owner);
        assert_eq(event::num_events(), 1);
        assert_eq(last_event_by_type<roles::OwnershipTransferStarted<T>>(), expected_event);
        assert_eq(roles.owner(), old_owner);
        assert_eq(*roles.pending_owner().borrow(), new_owner);
    }

    public(package) fun test_accept_ownership<T>(roles: &mut Roles<T>, scenario: &mut Scenario) {
        let old_owner = roles.owner();
        let pending_owner = roles.pending_owner();
        roles.accept_ownership(scenario.ctx());

        let expected_new_owner = *pending_owner.borrow();
        let expected_event = roles::create_owner_transferred_event<T>(old_owner, expected_new_owner);
        assert_eq(event::num_events(), 1);
        assert_eq(last_event_by_type<roles::OwnershipTransferred<T>>(), expected_event);
        assert_eq(roles.owner(), expected_new_owner);
        assert_eq(roles.pending_owner().is_none(), true);
    }

    public(package) fun test_update_blocklister<T>(new_blocklister: address, roles: &mut Roles<T>, scenario: &mut Scenario) {
        let old_blocklister = roles.blocklister();
        roles.update_blocklister(new_blocklister, scenario.ctx());

        let expected_event = roles::create_blocklister_changed_event<T>(old_blocklister, new_blocklister);
        assert_eq(event::num_events(), 1);
        assert_eq(last_event_by_type<roles::BlocklisterChanged<T>>(), expected_event);
        assert_eq(roles.blocklister(), new_blocklister);
    }

    public(package) fun test_update_pauser<T>(new_pauser: address, roles: &mut Roles<T>, scenario: &mut Scenario) {
        let old_pauser = roles.pauser();
        roles.update_pauser(new_pauser, scenario.ctx());

        let expected_event = roles::create_pauser_changed_event<T>(old_pauser, new_pauser);
        assert_eq(event::num_events(), 1);
        assert_eq(last_event_by_type<roles::PauserChanged<T>>(), expected_event);
        assert_eq(roles.pauser(), new_pauser);
    }

    public(package) fun test_update_metadata_updater<T>(new_metadata_updater: address, roles: &mut Roles<T>, scenario: &mut Scenario) {
        let old_metadata_updater = roles.metadata_updater();
        roles.update_metadata_updater(new_metadata_updater, scenario.ctx());

        let expected_event = roles::create_metadata_updater_changed_event<T>(old_metadata_updater, new_metadata_updater);
        assert_eq(event::num_events(), 1);
        assert_eq(last_event_by_type<roles::MetadataUpdaterChanged<T>>(), expected_event);

        assert_eq(roles.metadata_updater(), new_metadata_updater);
    }
}
