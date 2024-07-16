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

module sui_extensions::typed_upgrade_cap {
    use sui::{
        address,
        dynamic_object_field as dof,
        event,
        package::{
            UpgradeTicket, 
            UpgradeReceipt,
            UpgradeCap as SuiUpgradeCap
        },
        types::is_one_time_witness
    };
    use std::type_name;

    // === Errors ===

    const ENotOneTimeWitness: u64 = 0;
    const ETypeNotFromPackage: u64 = 1;  
    const EUpgradeCapDoesNotExist: u64 = 2;
    const EUpgradeCapExists: u64 = 3;

    // === Structs ===

    /// An `UpgradeCap<T>` that extends a `UpgradeCap` with a type parameter.
    /// The type must be a One-Time Witness type that comes
    /// from the package that the `UpgradeCap` controls.
    public struct UpgradeCap<phantom T> has key, store {
        id: UID
    }

    /// Key for retrieving UpgradeCap stored in an `UpgradeCap<T>` dynamic field.
    public struct UpgradeCapKey has copy, store, drop {}

    // === Events ===

    public struct SuiUpgradeCapDeposited<phantom T> has copy, drop {
        upgrade_cap_id: ID
    }

    public struct SuiUpgradeCapExtracted<phantom T> has copy, drop {
        upgrade_cap_id: ID
    }

    public struct UpgradeCapDestroyed<phantom T> has copy, drop {}

    public struct AuthorizeUpgrade<phantom T> has copy, drop {
        package_id: ID,
        policy: u8
    }

    public struct CommitUpgrade<phantom T> has copy, drop {
        package_id: ID
    }

    // === View-only functions ===

    /// The ID of the package that the stored `UpgradeCap` authorizes upgrades for.
    /// Can be `0x0` if the cap cannot currently authorize an upgrade because there is 
    /// already a pending upgrade in the transaction. Otherwise guaranteed to be the 
    /// latest version of any given package.
    public fun package<T>(typed_upgrade_cap: &UpgradeCap<T>): ID {
        typed_upgrade_cap.assert_upgrade_cap_exists();
        typed_upgrade_cap.borrow_upgrade_cap().package()
    }
    
    /// The most recent version of the package, increments by one for each
    /// successfully applied upgrade.
    public fun version<T>(typed_upgrade_cap: &UpgradeCap<T>): u64 {
        typed_upgrade_cap.assert_upgrade_cap_exists();
        typed_upgrade_cap.borrow_upgrade_cap().version()
    }
    
    /// The most permissive kind of upgrade currently supported by the stored `UpgradeCap`.
    public fun policy<T>(typed_upgrade_cap: &UpgradeCap<T>): u8 {
        typed_upgrade_cap.assert_upgrade_cap_exists();
        typed_upgrade_cap.borrow_upgrade_cap().policy()
    }

    // === Write functions ===

    /// Creates an empty `UpgradeCap<T>`.
    public fun empty<T: drop>(witness: T, ctx: &mut TxContext): (UpgradeCap<T>, T) {
        assert!(is_one_time_witness<T>(&witness), ENotOneTimeWitness);
        let typed_upgrade_cap = UpgradeCap<T> {
            id: object::new(ctx)
        };
        (typed_upgrade_cap, witness)
    }

    /// Performs an initial deposit of an `UpgradeCap` into an `UpgradeCap<T>`.
    /// `UpgradeCap` must control the package that `T` is defined in.
    /// Only callable if the `UpgradeCap` has not been used for an upgrade.
    public fun deposit<T>(typed_upgrade_cap: &mut UpgradeCap<T>, upgrade_cap: SuiUpgradeCap) {
        let package_address_of_type = address::from_ascii_bytes(
            type_name::get_with_original_ids<T>().get_address().as_bytes()
        );
        let package_address_of_upgrade_cap = &upgrade_cap.package().to_address();
        assert!(package_address_of_type == package_address_of_upgrade_cap, ETypeNotFromPackage);

        typed_upgrade_cap.assert_upgrade_cap_does_not_exist();
        let upgrade_cap_id = object::id(&upgrade_cap);
        typed_upgrade_cap.add_upgrade_cap(upgrade_cap);

        event::emit(SuiUpgradeCapDeposited<T> {
            upgrade_cap_id
        });
    }

    /// Extracts the stored `UpgradeCap`.
    public fun extract<T>(typed_upgrade_cap: &mut UpgradeCap<T>): SuiUpgradeCap {
        typed_upgrade_cap.assert_upgrade_cap_exists();
        let upgrade_cap = remove_upgrade_cap(typed_upgrade_cap);

        event::emit(SuiUpgradeCapExtracted<T> {
            upgrade_cap_id: object::id(&upgrade_cap)
        });
        upgrade_cap
    }

    /// Permanently destroys the `UpgradeCap<T>`.
    public fun destroy_empty<T>(typed_upgrade_cap: UpgradeCap<T>) {
        typed_upgrade_cap.assert_upgrade_cap_does_not_exist();

        let UpgradeCap { id } = typed_upgrade_cap;
        id.delete();

        event::emit(UpgradeCapDestroyed<T> {});
    }

    /// Issues an `UpgradeTicket` that authorizes the upgrade to a package content with `digest`
    /// for the package that the stored `UpgradeCap` manages. 
    public fun authorize_upgrade<T>(
        typed_upgrade_cap: &mut UpgradeCap<T>,
        policy: u8,
        digest: vector<u8>
    ): UpgradeTicket {
        typed_upgrade_cap.assert_upgrade_cap_exists();

        let package_id_before_authorization = typed_upgrade_cap.borrow_upgrade_cap().package();
        let upgrade_ticket = typed_upgrade_cap.borrow_upgrade_cap_mut().authorize(policy, digest);
        
        event::emit(AuthorizeUpgrade<T> { 
            package_id: package_id_before_authorization,
            policy
        });
        
        upgrade_ticket
    }

    /// Consumes an `UpgradeReceipt` to update the stored `UpgradeCap`, 
    /// finalizing the upgrade.
    public fun commit_upgrade<T>(
        typed_upgrade_cap: &mut UpgradeCap<T>,
        receipt: UpgradeReceipt
    ) {
        typed_upgrade_cap.assert_upgrade_cap_exists();

        let new_package_id = receipt.package();
        typed_upgrade_cap.borrow_upgrade_cap_mut().commit(receipt);

        event::emit(CommitUpgrade<T> { 
            package_id: new_package_id
        });
    }

    // === Helper functions ===

    /// Stores an `UpgradeCap` in a dynamic field on an `UpgradeCap<T>`.
    fun add_upgrade_cap<T>(typed_upgrade_cap: &mut UpgradeCap<T>, upgrade_cap: SuiUpgradeCap) {
        dof::add(&mut typed_upgrade_cap.id, UpgradeCapKey {}, upgrade_cap);
    }

    /// Returns an immutable reference to the `UpgradeCap` stored in a `UpgradeCap<T>`.
    fun borrow_upgrade_cap<T>(typed_upgrade_cap: &UpgradeCap<T>): &SuiUpgradeCap {
        dof::borrow(&typed_upgrade_cap.id, UpgradeCapKey {})
    }

    /// Returns a mutable reference to the `UpgradeCap` stored in a `UpgradeCap<T>`.
    fun borrow_upgrade_cap_mut<T>(typed_upgrade_cap: &mut UpgradeCap<T>): &mut SuiUpgradeCap {
        dof::borrow_mut(&mut typed_upgrade_cap.id, UpgradeCapKey {})
    }

    /// Removes an `UpgradeCap` that is stored in an `UpgradeCap<T>`
    fun remove_upgrade_cap<T>(typed_upgrade_cap: &mut UpgradeCap<T>): SuiUpgradeCap {
        dof::remove(&mut typed_upgrade_cap.id, UpgradeCapKey {})
    }

    /// Ensures that an `UpgradeCap` exists in an `UpgradeCap<T>`.
    fun assert_upgrade_cap_exists<T>(typed_upgrade_cap: &UpgradeCap<T>) {
        assert!(typed_upgrade_cap.exists_upgrade_cap(), EUpgradeCapDoesNotExist);
    }

    /// Ensures that an `UpgradeCap` does not exist in an `UpgradeCap<T>`.
    fun assert_upgrade_cap_does_not_exist<T>(typed_upgrade_cap: &UpgradeCap<T>) {
        assert!(!typed_upgrade_cap.exists_upgrade_cap(), EUpgradeCapExists);
    }

    /// Checks whether an `UpgradeCap` exists in an `UpgradeCap<T>`.
    public(package) fun exists_upgrade_cap<T>(typed_upgrade_cap: &UpgradeCap<T>): bool {
        dof::exists_with_type<_, SuiUpgradeCap>(&typed_upgrade_cap.id, UpgradeCapKey {})
    }

    // === Test Only ===

    #[test_only]
    public(package) fun add_upgrade_cap_for_testing<T>(typed_upgrade_cap: &mut UpgradeCap<T>, upgrade_cap: SuiUpgradeCap) {
        add_upgrade_cap(typed_upgrade_cap, upgrade_cap)
    }

    #[test_only]
    public(package) fun borrow_upgrade_cap_for_testing<T>(typed_upgrade_cap: &UpgradeCap<T>): &SuiUpgradeCap {
        typed_upgrade_cap.borrow_upgrade_cap()
    }

    #[test_only]
    public(package) fun borrow_upgrade_cap_mut_for_testing<T>(typed_upgrade_cap: &mut UpgradeCap<T>): &mut SuiUpgradeCap {
        typed_upgrade_cap.borrow_upgrade_cap_mut()
    }

    #[test_only]
    public(package) fun create_sui_upgrade_cap_deposited_event<T>(upgrade_cap_id: ID): SuiUpgradeCapDeposited<T> {
        SuiUpgradeCapDeposited { upgrade_cap_id }
    }

    #[test_only]
    public(package) fun create_sui_upgrade_cap_extracted_event<T>(upgrade_cap_id: ID): SuiUpgradeCapExtracted<T> {
        SuiUpgradeCapExtracted { upgrade_cap_id }
    }

    #[test_only]    
    public(package) fun create_authorize_upgrade_event<T>(package_id: ID, policy: u8): AuthorizeUpgrade<T> {
        AuthorizeUpgrade { package_id, policy }
    }

    #[test_only]    
    public(package) fun create_commit_upgrade_event<T>(package_id: ID): CommitUpgrade<T> {
        CommitUpgrade { package_id }
    }
}
