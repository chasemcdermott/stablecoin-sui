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

module stablecoin::roles {
    use sui::bag::{Self, Bag};
    use sui::event;
    use stablecoin::two_step_role::{Self, TwoStepRole};

    // === Structs ===

    public struct Roles<phantom T> has store {
        /// A bag that maintains the mapping of privileged roles and their addresses.
        /// Keys are structs that are suffixed with _Role<T>.
        /// Values are either addresses or objects containing more complex logic.
        data: Bag
    }

    /// Key used to map to the mutable TwoStepRole of the owner EOA
    public struct OwnerRole<phantom T> {} has copy, store, drop;
    /// Key used to map to the mutable address of the master minter EOA, controlled by owner
    public struct MasterMinterRole<phantom T> {} has copy, store, drop;
    /// Key used to map to the address of the blocklister EOA, controlled by owner
    public struct BlocklisterRole<phantom T> {} has copy, store, drop;
    /// Key used to map to the address of the pauser EOA, controlled by owner
    public struct PauserRole<phantom T> {} has copy, store, drop;
    /// Key used to map to the address of the metadata updater EOA, controlled by the owner
    public struct MetadataUpdaterRole<phantom T> {} has copy, store, drop;

    // === Events ===

    public struct MasterMinterChanged<phantom T> has copy, drop {
        old_master_minter: address,
        new_master_minter: address,
    }

    public struct BlocklisterChanged<phantom T> has copy, drop {
        old_blocklister: address,
        new_blocklister: address,
    }

    public struct PauserChanged<phantom T> has copy, drop {
        old_pauser: address,
        new_pauser: address,
    }

    public struct MetadataUpdaterChanged<phantom T> has copy, drop {
        old_metadata_updater: address,
        new_metadata_updater: address,
    }

    // === View-only functions ===

    /// Check the owner's TwoStepRole object mutably
    public(package) fun owner_role_mut<T>(roles: &mut Roles<T>): &mut TwoStepRole<OwnerRole<T>> {
        roles.data.borrow_mut(OwnerRole<T> {})
    }

    /// Check the owner's TwoStepRole object
    public(package) fun owner_role<T>(roles: &Roles<T>): &TwoStepRole<OwnerRole<T>> {
        roles.data.borrow(OwnerRole<T> {})
    }
    
    /// Check the owner address
    public fun owner<T>(roles: &Roles<T>): address {
        roles.owner_role().active_address()
    }

    /// Check the pending owner address
    public fun pending_owner<T>(roles: &Roles<T>): Option<address> {
        roles.owner_role().pending_address()
    }

    /// Check the master minter address
    public fun master_minter<T>(roles: &Roles<T>): address {
        *roles.data.borrow(MasterMinterRole<T> {})
    }

    /// Check the blocklister address
    public fun blocklister<T>(roles: &Roles<T>): address {
        *roles.data.borrow(BlocklisterRole<T> {})
    }

    /// Check the pauser address
    public fun pauser<T>(roles: &Roles<T>): address {
        *roles.data.borrow(PauserRole<T> {})
    }

    /// Check the metadata updater address
    public fun metadata_updater<T>(roles: &Roles<T>): address {
        *roles.data.borrow(MetadataUpdaterRole<T> {})
    }

    // === Write functions ===

    public(package) fun create_roles<T>(
        owner: address, 
        master_minter: address,
        blocklister: address, 
        pauser: address,
        metadata_updater: address,
        ctx: &mut TxContext,
    ): Roles<T> {
        let mut data = bag::new(ctx);
        data.add(OwnerRole<T> {}, two_step_role::new<OwnerRole<T>>(owner));
        data.add(MasterMinterRole<T> {}, master_minter);
        data.add(BlocklisterRole<T> {}, blocklister);
        data.add(PauserRole<T> {}, pauser);
        data.add(MetadataUpdaterRole<T> {}, metadata_updater);
        Roles {
            data
        }
    }

    /// Change the master minter address.
    public fun update_master_minter<T>(roles: &mut Roles<T>, new_master_minter: address, ctx: &TxContext) {
        roles.owner_role().assert_sender_is_active_role(ctx);

        let old_master_minter = roles.update_address(MasterMinterRole<T> {}, new_master_minter);

        event::emit(MasterMinterChanged<T> { 
            old_master_minter, 
            new_master_minter 
        });
    }

    /// Change the blocklister address.
    public fun update_blocklister<T>(roles: &mut Roles<T>, new_blocklister: address, ctx: &TxContext) {
        roles.owner_role().assert_sender_is_active_role(ctx);

        let old_blocklister = roles.update_address(BlocklisterRole<T> {}, new_blocklister);

        event::emit(BlocklisterChanged<T> {
            old_blocklister,
            new_blocklister
        });
    }

    /// Change the pauser address.
    public fun update_pauser<T>(roles: &mut Roles<T>, new_pauser: address, ctx: &TxContext) {
        roles.owner_role().assert_sender_is_active_role(ctx);

        let old_pauser = roles.update_address(PauserRole<T> {}, new_pauser);

        event::emit(PauserChanged<T> {
            old_pauser,
            new_pauser
        });
    }

    /// Change the metadata updater address.
    public fun update_metadata_updater<T>(roles: &mut Roles<T>, new_metadata_updater: address, ctx: &TxContext) {
        roles.owner_role().assert_sender_is_active_role(ctx);

        let old_metadata_updater = roles.update_address(MetadataUpdaterRole<T> {}, new_metadata_updater);

        event::emit(MetadataUpdaterChanged<T> {
            old_metadata_updater,
            new_metadata_updater
        });
    }

    /// Updates an existing simple address role and returns the previously set address.
    /// Fails if the key does not exist, or if the previously set value is not an address.
    fun update_address<T, K: copy + drop + store>(roles: &mut Roles<T>, key: K, new_address: address): address {
        let old_address = roles.data.remove(key);
        roles.data.add(key, new_address);
        old_address
    }

    // === Test Only ===

    #[test_only]
    public(package) fun create_master_minter_changed_event<T>(old_master_minter: address, new_master_minter: address): MasterMinterChanged<T> {
        MasterMinterChanged { old_master_minter, new_master_minter }
    }

    #[test_only]
    public(package) fun create_blocklister_changed_event<T>(old_blocklister: address, new_blocklister: address): BlocklisterChanged<T> {
        BlocklisterChanged { old_blocklister, new_blocklister }
    }

    #[test_only]
    public(package) fun create_pauser_changed_event<T>(old_pauser: address, new_pauser: address): PauserChanged<T> {
        PauserChanged { old_pauser, new_pauser }
    }

    #[test_only]
    public(package) fun create_metadata_updater_changed_event<T>(old_metadata_updater: address, new_metadata_updater: address): MetadataUpdaterChanged<T> {
        MetadataUpdaterChanged { old_metadata_updater, new_metadata_updater }
    }
}
