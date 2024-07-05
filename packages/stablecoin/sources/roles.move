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
    use sui::event;

    // === Errors ===

    const ENotOwner: u64 = 0;
    const EPendingOwnerNotSet: u64 = 1;
    const ENotPendingOwner: u64 = 2;
    const ESamePendingOwner: u64 = 3;
    const ESameBlocklister: u64 = 4;
    const ESamePauser: u64 = 5;
    const ENotAdmin: u64 = 6;
    const EPendingAdminNotSet: u64 = 7;
    const ENotPendingAdmin: u64 = 8;
    const ESamePendingAdmin: u64 = 9;
    const ESameMetadataUpdater: u64 = 10;

    // === Structs ===

    public struct Roles<phantom T> has store {
        /// Mutable address of the treasury admin EOA
        admin: address,
        /// Mutable address of the pending treasury admin EOA
        pending_admin: Option<address>,
        /// Mutable address of the owner EOA
        owner: address,
        /// Mutable address of the pending owner EOA
        pending_owner: Option<address>,
        /// Mutable address of the blocklister EOA, controlled by owner
        blocklister: address,
        /// Mutable address of the pauser EOA, controlled by owner
        pauser: address,
        /// Mutable address of the metadata updater EOA, controlled by the owner
        metadata_updater: address,
    }

    // === Events ===

    public struct TreasuryAdminTransferStarted<phantom T> has copy, drop {
        old_admin: address,
        new_admin: address,
    }

    public struct TreasuryAdminChanged<phantom T> has copy, drop {
        old_admin: address,
        new_admin: address,
    }

    public struct OwnershipTransferStarted<phantom T> has copy, drop {
        old_owner: address,
        new_owner: address,
    }

    public struct OwnershipTransferred<phantom T> has copy, drop {
        old_owner: address,
        new_owner: address,
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

    /// Check the treasury admin address
    public fun admin<T>(roles: &Roles<T>): address {
        roles.admin
    }

    /// Check the treasury pending admin address
    public fun pending_admin<T>(roles: &Roles<T>): Option<address> {
        roles.pending_admin
    }

    /// Check the owner address
    public fun owner<T>(roles: &Roles<T>): address {
        roles.owner
    }

    /// Check the pending owner address
    public fun pending_owner<T>(roles: &Roles<T>): Option<address> {
        roles.pending_owner
    }

    /// Check the blocklister address
    public fun blocklister<T>(roles: &Roles<T>): address {
        roles.blocklister
    }

    /// Check the pauser address
    public fun pauser<T>(roles: &Roles<T>): address {
        roles.pauser
    }

    /// Check the metadata updater address
    public fun metadata_updater<T>(roles: &Roles<T>): address {
        roles.metadata_updater
    }

    // === Write functions ===

    public(package) fun create_roles<T>(
        admin: address,
        owner: address, 
        blocklister: address, 
        pauser: address,
        metadata_updater: address,
    ): Roles<T> {
        Roles {
            admin,
            pending_admin: option::none(),
            owner,
            pending_owner: option::none(),
            blocklister,
            pauser,
            metadata_updater,
        }
    }

    /// Start treasury admin role transfer process.
    public fun change_admin<T>(
        roles: &mut Roles<T>,
        new_admin: address,
        ctx: &TxContext
    ) {
        assert!(roles.admin == ctx.sender(), ENotAdmin);
        assert!(!roles.pending_admin.contains(&new_admin), ESamePendingAdmin);

        roles.pending_admin = option::some(new_admin);

        event::emit(TreasuryAdminTransferStarted<T> {
            old_admin: roles.admin,
            new_admin,
        });
    }

    /// Finalize treasury admin role transfer process.
    public fun accept_admin<T>(
        roles: &mut Roles<T>,
        ctx: &TxContext
    ) {
        let old_admin = roles.admin;

        assert!(roles.pending_admin.is_some(), EPendingAdminNotSet);
        let new_admin = roles.pending_admin.extract();

        assert!(new_admin == ctx.sender(), ENotPendingAdmin);
        roles.admin = new_admin;

        event::emit(TreasuryAdminChanged<T> {
            old_admin,
            new_admin
        });
    }

    /// Start owner role transfer process.
    public fun transfer_ownership<T>(
        roles: &mut Roles<T>,
        new_owner: address,
        ctx: &TxContext
    ) {
        assert!(roles.owner == ctx.sender(), ENotOwner);
        assert!(!roles.pending_owner.contains(&new_owner), ESamePendingOwner);

        roles.pending_owner = option::some(new_owner);

        event::emit(OwnershipTransferStarted<T> {
            old_owner: roles.owner,
            new_owner,
        });
    }

    /// Finalize owner role transfer process.
    public fun accept_ownership<T>(
        roles: &mut Roles<T>,
        ctx: &TxContext
    ) {
        let old_owner = roles.owner;

        assert!(roles.pending_owner.is_some(), EPendingOwnerNotSet);
        let new_owner = roles.pending_owner.extract();

        assert!(new_owner == ctx.sender(), ENotPendingOwner);
        roles.owner = new_owner;

        event::emit(OwnershipTransferred<T> {
            old_owner,
            new_owner
        });
    }

    /// Change the blocklister address.
    public fun update_blocklister<T>(roles: &mut Roles<T>, new_blocklister: address, ctx: &TxContext) {
        assert!(roles.owner == ctx.sender(), ENotOwner);
        assert!(roles.blocklister != new_blocklister, ESameBlocklister);

        let old_blocklister = roles.blocklister;
        roles.blocklister = new_blocklister;

        event::emit(BlocklisterChanged<T> {
            old_blocklister,
            new_blocklister
        });
    }

    /// Change the pauser address.
    public fun update_pauser<T>(roles: &mut Roles<T>, new_pauser: address, ctx: &TxContext) {
        assert!(roles.owner == ctx.sender(), ENotOwner);
        assert!(roles.pauser != new_pauser, ESamePauser);

        let old_pauser = roles.pauser;
        roles.pauser = new_pauser;

        event::emit(PauserChanged<T> {
            old_pauser,
            new_pauser
        });
    }

    /// Change the metadata updater address.
    public fun update_metadata_updater<T>(roles: &mut Roles<T>, new_metadata_updater: address, ctx: &TxContext) {
        assert!(roles.owner == ctx.sender(), ENotOwner);
        assert!(roles.metadata_updater != new_metadata_updater, ESameMetadataUpdater);

        let old_metadata_updater = roles.metadata_updater;
        roles.metadata_updater = new_metadata_updater;

        event::emit(MetadataUpdaterChanged<T> {
            old_metadata_updater,
            new_metadata_updater
        });
    }
}
