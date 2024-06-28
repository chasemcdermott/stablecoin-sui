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
    const EZeroAddress: u64 = 10;

    // === Structs ===

    public struct Roles has store {
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
    }

    // === Events ===

    public struct TreasuryAdminTransferStarted has copy, drop {
        old_admin: address,
        new_admin: address,
    }

    public struct TreasuryAdminChanged has copy, drop {
        old_admin: address,
        new_admin: address,
    }

    public struct OwnershipTransferStarted has copy, drop {
        old_owner: address,
        new_owner: address,
    }

    public struct OwnershipTransferred has copy, drop {
        old_owner: address,
        new_owner: address,
    }

    public struct BlocklisterChanged has copy, drop {
        old_blocklister: address,
        new_blocklister: address,
    }

    public struct PauserChanged has copy, drop {
        old_pauser: address,
        new_pauser: address,
    }

    // === View-only functions ===

    /// Check the treasury admin address
    public fun admin(roles: &Roles): address {
        roles.admin
    }

    /// Check the treasury pending admin address
    public fun pending_admin(roles: &Roles): Option<address> {
        roles.pending_admin
    }

    /// Check the owner address
    public fun owner(roles: &Roles): address {
        roles.owner
    }

    /// Check the pending owner address
    public fun pending_owner(roles: &Roles): Option<address> {
        roles.pending_owner
    }

    /// Check the blocklister address
    public fun blocklister(roles: &Roles): address {
        roles.blocklister
    }

    /// Check the pauser address
    public fun pauser(roles: &Roles): address {
        roles.pauser
    }

    // === Write functions ===

    public(package) fun create_roles(
        admin: address,
        owner: address, 
        blocklister: address, 
        pauser: address, 
    ): Roles {

        Roles {
            admin,
            pending_admin: option::none(),
            owner,
            pending_owner: option::none(),
            blocklister,
            pauser,
        }
    }

    /// Start treasury admin role transfer process.
    public fun change_admin(
        roles: &mut Roles,
        new_admin: address,
        ctx: &TxContext
    ) {
        assert!(roles.admin == ctx.sender(), ENotAdmin);
        assert!(!roles.pending_admin.contains(&new_admin), ESamePendingAdmin);
        assert!(new_admin != @0x0, EZeroAddress);

        roles.pending_admin = option::some(new_admin);

        event::emit(TreasuryAdminTransferStarted {
            old_admin: roles.admin,
            new_admin,
        });
    }

    /// Finalize treasury admin role transfer process.
    public fun accept_admin(
        roles: &mut Roles,
        ctx: &TxContext
    ) {
        let old_admin = roles.admin;

        assert!(roles.pending_admin.is_some(), EPendingAdminNotSet);
        let new_admin = roles.pending_admin.extract();

        assert!(new_admin == ctx.sender(), ENotPendingAdmin);
        roles.admin = new_admin;

        event::emit(TreasuryAdminChanged { old_admin, new_admin });
    }

    /// Start owner role transfer process.
    public fun transfer_ownership(
        roles: &mut Roles,
        new_owner: address,
        ctx: &TxContext
    ) {
        assert!(roles.owner == ctx.sender(), ENotOwner);
        assert!(!roles.pending_owner.contains(&new_owner), ESamePendingOwner);

        roles.pending_owner = option::some(new_owner);

        event::emit(OwnershipTransferStarted {
            old_owner: roles.owner,
            new_owner,
        });
    }

    /// Finalize owner role transfer process.
    public fun accept_ownership(
        roles: &mut Roles,
        ctx: &TxContext
    ) {
        let old_owner = roles.owner;

        assert!(roles.pending_owner.is_some(), EPendingOwnerNotSet);
        let new_owner = roles.pending_owner.extract();

        assert!(new_owner == ctx.sender(), ENotPendingOwner);
        roles.owner = new_owner;

        event::emit(OwnershipTransferred { old_owner, new_owner });
    }

    /// Change the blocklister address.
    public fun update_blocklister(roles: &mut Roles, new_blocklister: address, ctx: &TxContext) {
        assert!(roles.owner == ctx.sender(), ENotOwner);
        assert!(roles.blocklister != new_blocklister, ESameBlocklister);

        let old_blocklister = roles.blocklister;
        roles.blocklister = new_blocklister;

        event::emit(BlocklisterChanged { old_blocklister, new_blocklister });
    }

    /// Change the pauser address.
    public fun update_pauser(roles: &mut Roles, new_pauser: address, ctx: &TxContext) {
        assert!(roles.owner == ctx.sender(), ENotOwner);
        assert!(roles.pauser != new_pauser, ESamePauser);

        let old_pauser = roles.pauser;
        roles.pauser = new_pauser;

        event::emit(PauserChanged { old_pauser, new_pauser });
    }

    // === Test Only ===

    #[test_only]
    public(package) fun destroy(self: Roles) {
        let Roles { admin: _, pending_admin: _, owner: _, pending_owner: _, blocklister: _, pauser: _ } = self;
    }
}
