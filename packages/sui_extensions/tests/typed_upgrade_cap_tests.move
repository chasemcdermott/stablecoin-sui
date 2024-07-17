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

module sui_extensions::typed_upgrade_cap_tests {
    use sui::{
        event,
        package::{Self, UpgradeTicket, UpgradeReceipt, UpgradeCap as SuiUpgradeCap},
        test_scenario::{Self, Scenario},
        test_utils::{assert_eq, destroy, create_one_time_witness}
    };
    use sui_extensions::typed_upgrade_cap::{Self, UpgradeCap};

    public struct TYPED_UPGRADE_CAP_TESTS has drop {}
    public struct NOT_ONE_TIME_WITNESS has drop {}

    const DEPLOYER: address = @0x10;
    const UPGRADE_CAP_OWNER: address = @0x20;
    const RANDOM_ADDRESS: address = @0x30;
    
    const UPGRADE_CAP_PACKAGE_ID: address = @0x1000;
    const TEST_DIGEST: vector<u8> = vector[0, 1, 2];

    #[test, expected_failure(abort_code = ::sui_extensions::typed_upgrade_cap::ENotOneTimeWitness)]
    fun empty__should_fail_if_type_is_not_one_time_witness() {   
        let mut scenario = test_scenario::begin(DEPLOYER);

        destroy(test_empty(&mut scenario, NOT_ONE_TIME_WITNESS {}));
        
        scenario.end();
    }

    #[test]
    fun empty__should_succeed_and_pass_all_assertions() {   
        let mut scenario = test_scenario::begin(DEPLOYER);

        destroy(test_empty(&mut scenario, create_one_time_witness<TYPED_UPGRADE_CAP_TESTS>()));
        
        scenario.end();
    }

    #[test, expected_failure(abort_code = ::sui_extensions::typed_upgrade_cap::ETypeNotFromPackage)]
    fun deposit__should_fail_if_type_is_not_from_package() {
        // Create an `UpgradeCap<T>`.
        let mut scenario = test_scenario::begin(DEPLOYER);
        {
            let typed_upgrade_cap = test_empty(&mut scenario, create_one_time_witness<TYPED_UPGRADE_CAP_TESTS>());
            transfer::public_transfer(typed_upgrade_cap, UPGRADE_CAP_OWNER);
        };

        // Attempt to deposit an `UpgradeCap` that has a different package id from the package that
        // defines `TYPED_UPGRADE_CAP_TESTS`, should fail.
        scenario.next_tx(UPGRADE_CAP_OWNER);
        assert_eq(RANDOM_ADDRESS != @sui_extensions, true);
        let upgrade_cap_for_random_package = create_upgrade_cap(&mut scenario, RANDOM_ADDRESS.to_id());
        test_deposit<TYPED_UPGRADE_CAP_TESTS>(&scenario, upgrade_cap_for_random_package);
        
        scenario.end();
    }
    
    #[test, expected_failure(abort_code = ::sui_extensions::typed_upgrade_cap::EUpgradeCapExists)]
    fun deposit__should_fail_if_upgrade_cap_exists() {
        // Create an `UpgradeCap<T>`.
        let mut scenario = test_scenario::begin(DEPLOYER);
        {
            let typed_upgrade_cap = test_empty(&mut scenario, create_one_time_witness<TYPED_UPGRADE_CAP_TESTS>());
            transfer::public_transfer(typed_upgrade_cap, UPGRADE_CAP_OWNER);
        };

        // Force add an `UpgradeCap`. In practice, this is not possible.
        scenario.next_tx(UPGRADE_CAP_OWNER);
        {
            let mut typed_upgrade_cap = scenario.take_from_sender<UpgradeCap<TYPED_UPGRADE_CAP_TESTS>>();

            let upgrade_cap = create_upgrade_cap(&mut scenario, @sui_extensions.to_id());
            typed_upgrade_cap.add_upgrade_cap_for_testing(upgrade_cap);

            scenario.return_to_sender(typed_upgrade_cap);
        };

        // Attempt to deposit an `UpgradeCap`, should fail.
        scenario.next_tx(UPGRADE_CAP_OWNER);
        let upgrade_cap = create_upgrade_cap(&mut scenario, @sui_extensions.to_id());
        test_deposit<TYPED_UPGRADE_CAP_TESTS>(&scenario, upgrade_cap);
        
        scenario.end();
    }

    #[test]
    fun deposit__should_succeed_and_pass_all_assertions() {
        // Create an `UpgradeCap<T>`.
        let mut scenario = test_scenario::begin(DEPLOYER);
        {
            let typed_upgrade_cap = test_empty(&mut scenario, create_one_time_witness<TYPED_UPGRADE_CAP_TESTS>());
            transfer::public_transfer(typed_upgrade_cap, UPGRADE_CAP_OWNER);
        };

        // Deposit an `UpgradeCap`.
        scenario.next_tx(UPGRADE_CAP_OWNER);
        let upgrade_cap = create_upgrade_cap(&mut scenario, @sui_extensions.to_id());
        test_deposit<TYPED_UPGRADE_CAP_TESTS>(&scenario, upgrade_cap);
        
        scenario.end();
    }

    #[test, expected_failure(abort_code = ::sui_extensions::typed_upgrade_cap::EUpgradeCapDoesNotExist)]
    fun extract__should_fail_if_upgrade_cap_is_missing () {
        let mut scenario = setup_with_typed_upgrade_cap();

        // Extract the `UpgradeCap`.
        scenario.next_tx(UPGRADE_CAP_OWNER);
        destroy(test_extract<TYPED_UPGRADE_CAP_TESTS>(&scenario));

        // Extract the `UpgradeCap` again, should fail.
        scenario.next_tx(UPGRADE_CAP_OWNER);
        {
            let mut typed_upgrade_cap = scenario.take_from_sender<UpgradeCap<TYPED_UPGRADE_CAP_TESTS>>();
            destroy(typed_upgrade_cap.extract());
            scenario.return_to_sender(typed_upgrade_cap);
        };
        
        scenario.end();
    }

    #[test]
    fun extract__should_succeed_and_pass_all_assertions() {
        let mut scenario = setup_with_typed_upgrade_cap();

        scenario.next_tx(UPGRADE_CAP_OWNER);
        destroy(test_extract<TYPED_UPGRADE_CAP_TESTS>(&scenario));
        
        scenario.end();
    }

    #[test, expected_failure(abort_code = ::sui_extensions::typed_upgrade_cap::EUpgradeCapExists)]
    fun destroy_empty__should_fail_if_upgrade_cap_exists () {
        let mut scenario = setup_with_typed_upgrade_cap();

        // Attempt to destroy the `UpgradeCap<T>` when the `UpgradeCap` has not
        // been extracted, should fail.
        scenario.next_tx(UPGRADE_CAP_OWNER);
        test_destroy_empty<TYPED_UPGRADE_CAP_TESTS>(&mut scenario);
        
        scenario.end();
    }
    
    #[test]
    fun destroy_empty__should_succeed_and_pass_all_assertions() {
        let mut scenario = setup_with_typed_upgrade_cap();

        scenario.next_tx(UPGRADE_CAP_OWNER);
        destroy(test_extract<TYPED_UPGRADE_CAP_TESTS>(&scenario));

        scenario.next_tx(UPGRADE_CAP_OWNER);
        test_destroy_empty<TYPED_UPGRADE_CAP_TESTS>(&mut scenario);
        
        scenario.end();
    }

    #[test, expected_failure(abort_code = ::sui_extensions::typed_upgrade_cap::EUpgradeCapDoesNotExist)]
    fun authorize_upgrade__should_fail_if_upgrade_cap_is_missing () {
        let mut scenario = setup_with_typed_upgrade_cap();

        // Extract the `UpgradeCap`.
        scenario.next_tx(UPGRADE_CAP_OWNER);
        destroy(test_extract<TYPED_UPGRADE_CAP_TESTS>(&scenario));

        // Attempt to authorize an upgrade after the `UpgradeCap` has been extracted, should fail.
        scenario.next_tx(UPGRADE_CAP_OWNER);
        destroy(test_authorize_upgrade<TYPED_UPGRADE_CAP_TESTS>(
            &scenario,
            package::compatible_policy(),
            TEST_DIGEST
        ));
        
        scenario.end();
    }

    #[test, expected_failure(abort_code = ::sui::package::EAlreadyAuthorized)]
    fun authorize_upgrade__should_fail_if_upgrade_cap_has_authorized_an_upgrade () {
        let mut scenario = setup_with_typed_upgrade_cap();

        // Authorize an upgrade.
        scenario.next_tx(UPGRADE_CAP_OWNER);
        destroy(test_authorize_upgrade<TYPED_UPGRADE_CAP_TESTS>(
            &scenario,
            package::compatible_policy(),
            TEST_DIGEST
        ));

        // Attempt to authorize another upgrade, should fail as there is a pending
        // upgrade.
        scenario.next_tx(UPGRADE_CAP_OWNER);
        destroy(test_authorize_upgrade<TYPED_UPGRADE_CAP_TESTS>(
            &scenario,
            package::compatible_policy(),
            TEST_DIGEST
        ));
        
        scenario.end();
    }

    #[test, expected_failure(abort_code = ::sui::package::ETooPermissive)]
    fun authorize_upgrade__should_fail_if_upgrade_is_too_permissive () {
        let mut scenario = setup_with_typed_upgrade_cap();

        // Restrict the underlying `UpgradeCap`'s upgrade policy.
        scenario.next_tx(UPGRADE_CAP_OWNER);
        {
            let mut typed_upgrade_cap = scenario.take_from_sender<UpgradeCap<TYPED_UPGRADE_CAP_TESTS>>();
            typed_upgrade_cap.borrow_upgrade_cap_mut_for_testing().only_dep_upgrades();
            scenario.return_to_sender(typed_upgrade_cap);
        };

        // Attempt to authorize an upgrade that has a more permissive policy, should fail.
        scenario.next_tx(UPGRADE_CAP_OWNER);
        destroy(test_authorize_upgrade<TYPED_UPGRADE_CAP_TESTS>(
            &scenario,
            package::compatible_policy(),
            TEST_DIGEST
        ));
        
        scenario.end();
    }

    #[test]
    fun authorize_upgrade__should_succeed_and_pass_all_assertions() {
        let mut scenario = setup_with_typed_upgrade_cap();

        scenario.next_tx(UPGRADE_CAP_OWNER);
        destroy(test_authorize_upgrade<TYPED_UPGRADE_CAP_TESTS>(
            &scenario,
            package::compatible_policy(),
            TEST_DIGEST
        ));
        
        scenario.end();
    }

    #[test, expected_failure(abort_code = ::sui_extensions::typed_upgrade_cap::EUpgradeCapDoesNotExist)]
    fun commit_upgrade__should_fail_if_upgrade_cap_is_missing () {
        let mut scenario = setup_with_typed_upgrade_cap();
        
        // Authorize an upgrade with the `UpgradeCap`.
        scenario.next_tx(UPGRADE_CAP_OWNER);
        let upgrade_ticket = test_authorize_upgrade<TYPED_UPGRADE_CAP_TESTS>(
            &scenario,
            package::compatible_policy(),
            TEST_DIGEST
        );

        // Perform the upgrade with the authorization ticket.
        scenario.next_tx(UPGRADE_CAP_OWNER);
        let upgrade_receipt = package::test_upgrade(upgrade_ticket);

        // Extract the `UpgradeCap`.
        scenario.next_tx(UPGRADE_CAP_OWNER);
        destroy(test_extract<TYPED_UPGRADE_CAP_TESTS>(&scenario));

        // Attempt to commit the upgrade after the `UpgradeCap` has been extracted, should fail.
        scenario.next_tx(UPGRADE_CAP_OWNER);
        test_commit_upgrade<TYPED_UPGRADE_CAP_TESTS>(
            &scenario,
            upgrade_receipt
        );
        
        scenario.end();
    }

    #[test, expected_failure(abort_code = ::sui::package::EWrongUpgradeCap)]
    fun commit_upgrade__should_fail_if_upgrade_cap_and_receipt_are_mismatched () {
        let mut scenario = setup_with_typed_upgrade_cap();

        // Perform an upgrade cycle for a random package.
        scenario.next_tx(DEPLOYER);
        let mut upgrade_cap_for_random_package = create_upgrade_cap(&mut scenario, RANDOM_ADDRESS.to_id());
        let upgrade_ticket_for_random_package = upgrade_cap_for_random_package.authorize(
            package::compatible_policy(),
            TEST_DIGEST
        );
        let upgrade_receipt_for_random_package = package::test_upgrade(upgrade_ticket_for_random_package);
        destroy(upgrade_cap_for_random_package);

        // Attempt to commit the upgrade using an `UpgradeReceipt` that did not derive from the `UpgradeCap`, should fail.
        scenario.next_tx(UPGRADE_CAP_OWNER);
        test_commit_upgrade<TYPED_UPGRADE_CAP_TESTS>(
            &scenario,
            upgrade_receipt_for_random_package
        );
        
        scenario.end();
    }

    #[test]
    fun commit_upgrade__should_succeed_and_pass_all_assertions() {
        let mut scenario = setup_with_typed_upgrade_cap();
        
        // Authorize an upgrade with the `UpgradeCap`.
        scenario.next_tx(UPGRADE_CAP_OWNER);
        let upgrade_ticket = test_authorize_upgrade<TYPED_UPGRADE_CAP_TESTS>(
            &scenario,
            package::compatible_policy(),
            TEST_DIGEST
        );

        // Perform the upgrade with the authorization ticket.
        scenario.next_tx(UPGRADE_CAP_OWNER);
        let upgrade_receipt = package::test_upgrade(upgrade_ticket);

        // Commit the results of the upgrade to the `UpgradeCap`.
        scenario.next_tx(UPGRADE_CAP_OWNER);
        test_commit_upgrade<TYPED_UPGRADE_CAP_TESTS>(
            &scenario,
            upgrade_receipt
        );
        
        scenario.end();
    }

    // === Helpers ===

    fun setup_with_typed_upgrade_cap(): Scenario {
        // Here, the package id that `UpgradeCap` controls does not match the id of the package 
        // that defines `TYPED_UPGRADE_CAP_TESTS`. This is intentional as authorizing an upgrade
        // requires that the `UpgradeCap`'s package is a non-0x0 address. Conversely, the package
        // id of the test type `TYPED_UPGRADE_CAP_TESTS` depends on the address set as the 
        // package's alias in the package manifest file, and for operational purposes, should be 
        // able to set to 0x0.
        // 
        // This is a workaround to make the test environment isolated.
        let mut scenario = test_scenario::begin(DEPLOYER);
        
        assert_eq(UPGRADE_CAP_PACKAGE_ID != @sui_extensions, true);
        
        let mut typed_upgrade_cap = test_empty(&mut scenario, create_one_time_witness<TYPED_UPGRADE_CAP_TESTS>());
        let upgrade_cap = create_upgrade_cap(&mut scenario, UPGRADE_CAP_PACKAGE_ID.to_id());
        typed_upgrade_cap.add_upgrade_cap_for_testing(upgrade_cap);

        transfer::public_transfer(typed_upgrade_cap, UPGRADE_CAP_OWNER);

        scenario
    }

    fun test_empty<T: drop>(scenario: &mut Scenario, witness: T): UpgradeCap<T> {
        let (typed_upgrade_cap, _) = typed_upgrade_cap::empty<T>(witness, scenario.ctx());

        assert_eq(typed_upgrade_cap.exists_upgrade_cap(), false);

        typed_upgrade_cap
    }

    fun test_deposit<T>(scenario: &Scenario, upgrade_cap: SuiUpgradeCap) {
        let mut typed_upgrade_cap = scenario.take_from_sender<UpgradeCap<T>>();

        let expected_upgrade_cap_id = object::id(&upgrade_cap);
        let expected_upgrade_cap_package = upgrade_cap.package();
        let expected_upgrade_cap_version = upgrade_cap.version();
        let expected_upgrade_cap_policy = upgrade_cap.policy();
        
        typed_upgrade_cap.deposit(upgrade_cap);

        assert_eq(typed_upgrade_cap.exists_upgrade_cap(), true);
        assert_eq(object::id(typed_upgrade_cap.borrow_upgrade_cap_for_testing()), expected_upgrade_cap_id);
        check_upgrade_cap_deep(
            &typed_upgrade_cap,
            expected_upgrade_cap_package,
            expected_upgrade_cap_version,
            expected_upgrade_cap_policy
        );

        // Ensure that the correct event was emitted.
        assert_eq(event::num_events(), 1);
        assert_eq(
            last_event_by_type(),
            typed_upgrade_cap::create_sui_upgrade_cap_deposited_event<T>(expected_upgrade_cap_id)
        );

        scenario.return_to_sender(typed_upgrade_cap);
    }

    fun test_extract<T>(scenario: &Scenario): SuiUpgradeCap {
        let mut typed_upgrade_cap = scenario.take_from_sender<UpgradeCap<T>>();
        
        let prev_upgrade_cap_package = typed_upgrade_cap.borrow_upgrade_cap_for_testing().package();
        let prev_upgrade_cap_version = typed_upgrade_cap.borrow_upgrade_cap_for_testing().version();
        let prev_upgrade_cap_policy = typed_upgrade_cap.borrow_upgrade_cap_for_testing().policy();

        let upgrade_cap = typed_upgrade_cap.extract();
        let upgrade_cap_id = object::id(&upgrade_cap);

        assert_eq(typed_upgrade_cap.exists_upgrade_cap(), false);

        // Ensure that the extracted `UpgradeCap` has the same fields.
        check_upgrade_cap(
            &upgrade_cap,
            prev_upgrade_cap_package,
            prev_upgrade_cap_version,
            prev_upgrade_cap_policy
        );

        // Ensure that the correct event was emitted.
        assert_eq(event::num_events(), 1);
        assert_eq(
            last_event_by_type(),
            typed_upgrade_cap::create_sui_upgrade_cap_extracted_event<T>(upgrade_cap_id)
        );

        scenario.return_to_sender(typed_upgrade_cap);
        upgrade_cap
    }

    fun test_destroy_empty<T>(scenario: &mut Scenario){
        let typed_upgrade_cap = scenario.take_from_sender<UpgradeCap<T>>();
        let typed_upgrade_cap_object_id = object::id(&typed_upgrade_cap);

        typed_upgrade_cap.destroy_empty();

        // Ensure that the correct event was emitted.
        assert_eq(event::num_events(), 1);
        assert_eq(event::events_by_type<typed_upgrade_cap::UpgradeCapDestroyed<T>>().length(), 1);

        // Ensure that the `UpgradeCap<T>` was destroyed.
        let prev_tx_effects = scenario.next_tx(RANDOM_ADDRESS);
        assert_eq(prev_tx_effects.deleted(), vector[typed_upgrade_cap_object_id]);
    }

    fun test_authorize_upgrade<T>(scenario: &Scenario, policy: u8, digest: vector<u8>): UpgradeTicket {
        let mut typed_upgrade_cap = scenario.take_from_sender<UpgradeCap<T>>();

        let prev_upgrade_cap_package = typed_upgrade_cap.package();
        let prev_upgrade_cap_version = typed_upgrade_cap.version();
        let prev_upgrade_cap_policy = typed_upgrade_cap.policy();

        let upgrade_ticket = typed_upgrade_cap.authorize_upgrade(policy, digest);

        // Ensure that the `UpgradeTicket` is created correctly.
        check_upgrade_ticket(
            &upgrade_ticket,
            prev_upgrade_cap_package,
            policy,
            digest
        );

        check_upgrade_cap_deep(
            &typed_upgrade_cap,
            @0x0.to_id(),
            prev_upgrade_cap_version,
            prev_upgrade_cap_policy
        );

        // Ensure that the correct events were emitted.
        assert_eq(event::num_events(), 1);
        assert_eq(
            last_event_by_type(), 
            typed_upgrade_cap::create_authorize_upgrade_event<T>(prev_upgrade_cap_package, policy)
        );

        scenario.return_to_sender(typed_upgrade_cap);
        upgrade_ticket
    }

    fun test_commit_upgrade<T>(scenario: &Scenario, receipt: UpgradeReceipt) {
        let mut typed_upgrade_cap = scenario.take_from_sender<UpgradeCap<T>>();

        let prev_upgrade_cap_version = typed_upgrade_cap.version();
        let prev_upgrade_cap_policy = typed_upgrade_cap.policy();
        let new_upgrade_cap_package = receipt.package();

        typed_upgrade_cap.commit_upgrade(receipt);

        check_upgrade_cap_deep(
            &typed_upgrade_cap,
            new_upgrade_cap_package,
            prev_upgrade_cap_version + 1,
            prev_upgrade_cap_policy
        );

        // Ensure that the correct events were emitted.
        assert_eq(event::num_events(), 1);
        assert_eq(
            last_event_by_type(), 
            typed_upgrade_cap::create_commit_upgrade_event<T>(new_upgrade_cap_package)
        );
        
        scenario.return_to_sender(typed_upgrade_cap);
    }

    fun create_upgrade_cap(
        scenario: &mut Scenario,
        package_id: ID,
    ): SuiUpgradeCap {
        let upgrade_cap = package::test_publish(package_id, scenario.ctx());
        check_upgrade_cap(
            &upgrade_cap,
            package_id,
            1,
            package::compatible_policy()
        );
        upgrade_cap
    }

    fun check_upgrade_cap_deep<T>(typed_upgrade_cap: &UpgradeCap<T>, package: ID, version: u64, policy: u8) {
        assert_eq(typed_upgrade_cap.package(), package);
        assert_eq(typed_upgrade_cap.version(), version);
        assert_eq(typed_upgrade_cap.policy(), policy);
        
        check_upgrade_cap(
            typed_upgrade_cap.borrow_upgrade_cap_for_testing(),
            package,
            version,
            policy
        );
    }

    fun check_upgrade_cap(upgrade_cap: &SuiUpgradeCap, package: ID, version: u64, policy: u8) {
        assert_eq(upgrade_cap.package(), package);
        assert_eq(upgrade_cap.version(), version);
        assert_eq(upgrade_cap.policy(), policy);
    }

    fun check_upgrade_ticket(upgrade_ticket: &UpgradeTicket, package: ID, policy: u8, digest: vector<u8>) {
        assert_eq(upgrade_ticket.package(), package);
        assert_eq(upgrade_ticket.policy(), policy);
        assert_eq(*upgrade_ticket.digest(), digest);
    }

    fun last_event_by_type<T: copy + drop>(): T {
        let events_by_type = event::events_by_type<T>();
        assert_eq(events_by_type.is_empty(), false);
        *events_by_type.borrow(events_by_type.length() - 1)
    }
}
