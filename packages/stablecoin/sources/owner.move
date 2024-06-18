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

module stablecoin::owner {
    use sui::event;
    use sui::coin::DenyCap;

    // === Errors ===

    const ENotOwner: u64 = 0;
    const EPendingOwnerNotSet: u64 = 1;
    const ENotPendingOwner: u64 = 2;
    const ESamePendingOwner: u64 = 3;
    const ESameBlocklister: u64 = 4;
    const ESamePauser: u64 = 5;

    // === Structs ===

    public struct OwnerService<phantom T> has key, store {
        id: UID,
        owner: address,
        pending_owner: Option<address>,
    }

    public struct BlocklisterService<phantom T> has key, store {
        id: UID,
        blocklister: address,
        deny_cap: DenyCap<T>,
    }

    public struct PauserService<phantom T> has key, store {
        id: UID,
        pauser: address,
    }

    // === Events ===

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

    /// Check the owner address
    public fun owner<T>(owner_service: &OwnerService<T>): address {
        owner_service.owner
    }

    /// Check the pending owner address
    public fun pending_owner<T>(owner_service: &OwnerService<T>): Option<address> {
        owner_service.pending_owner
    }

    /// Check the blocklister address
    public fun blocklister<T>(blocklist_service: &BlocklisterService<T>): address {
        blocklist_service.blocklister
    }

    /// Check the pauser address
    public fun pauser<T>(pause_service: &PauserService<T>): address {
        pause_service.pauser
    }

    // === Write functions ===

    public fun create_owner_service<T>(
        deny_cap: DenyCap<T>, 
        owner: address, 
        blocklister: address, 
        pauser: address, 
        ctx: &mut TxContext
    ): (OwnerService<T>, BlocklisterService<T>, PauserService<T>) {

        let blocklist_service = BlocklisterService<T> {
            id: object::new(ctx),
            blocklister,
            deny_cap,
        };

        let pause_service = PauserService<T> {
            id: object::new(ctx),
            pauser,
        };

        let owner_service = OwnerService<T> {
            id: object::new(ctx),
            owner,
            pending_owner: option::none(),
        };

        (owner_service, blocklist_service, pause_service)
    }

    /// Start owner role transfer process.
    public fun transfer_ownership<T>(
        owner_service: &mut OwnerService<T>,
        new_owner: address,
        ctx: &TxContext
    ) {
        assert!(owner_service.owner == ctx.sender(), ENotOwner);
        assert!(!owner_service.pending_owner.contains(&new_owner), ESamePendingOwner);

        owner_service.pending_owner = option::some(new_owner);

        event::emit(OwnershipTransferStarted {
            old_owner: owner_service.owner,
            new_owner,
        });
    }

    /// Finalize owner role transfer process.
    public fun accept_ownership<T>(
        owner_service: &mut OwnerService<T>,
        ctx: &TxContext
    ) {
        let old_owner = owner_service.owner;

        assert!(owner_service.pending_owner.is_some(), EPendingOwnerNotSet);
        let new_owner = owner_service.pending_owner.extract();

        assert!(new_owner == ctx.sender(), ENotPendingOwner);
        owner_service.owner = new_owner;

        event::emit(OwnershipTransferred { old_owner, new_owner });
    }

    /// Change the blocklister address.
    public fun update_blocklister<T>(blocklist_service: &mut BlocklisterService<T>, owner_service: &OwnerService<T>, new_blocklister: address, ctx: &TxContext) {
        assert!(owner_service.owner == ctx.sender(), ENotOwner);
        assert!(blocklist_service.blocklister != new_blocklister, ESameBlocklister);

        let old_blocklister = blocklist_service.blocklister;
        blocklist_service.blocklister = new_blocklister;

        event::emit(BlocklisterChanged { old_blocklister, new_blocklister });
    }

    /// Change the pauser address.
    public fun update_pauser<T>(pause_service: &mut PauserService<T>, owner_service: &OwnerService<T>, new_pauser: address, ctx: &TxContext) {
        assert!(owner_service.owner == ctx.sender(), ENotOwner);
        assert!(pause_service.pauser != new_pauser, ESamePauser);

        let old_pauser = pause_service.pauser;
        pause_service.pauser = new_pauser;

        event::emit(PauserChanged { old_pauser, new_pauser });
    }

    #[test_only]
    public fun get_deny_cap_id_for_testing<T>(blocklister: &BlocklisterService<T>): ID {
        object::id(&blocklister.deny_cap)
    }
}
