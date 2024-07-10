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

module stablecoin::treasury {
    use std::string;
    use std::ascii;
    use sui::coin::{Self, Coin, TreasuryCap, DenyCap, CoinMetadata};
    use sui::deny_list::{DenyList};
    use sui::event;
    use sui::table::{Self, Table};
    use sui::dynamic_object_field as dof;
    use stablecoin::mint_allowance::{Self, MintAllowance};
    use stablecoin::roles::{Self, Roles};

    // === Errors ===

    const EControllerAlreadyConfigured: u64 = 0;
    const EDeniedAddress: u64 = 1;
    const EDenyCapNotFound: u64 = 2;
    const EInsufficientAllowance: u64 = 3;
    const ENotBlocklister: u64 = 4;
    const ENotController: u64 = 5;
    const ENotMasterMinter: u64 = 6;
    const ENotMetadataUpdater: u64 = 7;
    const ENotMinter: u64 = 8;
    const ENotPauser: u64 = 9;
    const ETreasuryCapNotFound: u64 = 10;
    const EUnimplemented: u64 = 11;
    const EZeroAmount: u64 = 12;

    // === Structs ===

    /// A Treasury of type `T` that stores a TreasuryCap object 
    /// and additional configurations related to minting and burning.
    public struct Treasury<phantom T> has key, store {
        id: UID,
        /// Mapping between controllers and mint cap IDs
        controllers: Table<address, ID>,
        /// Mapping between mint cap IDs and mint allowances
        mint_allowances: Table<ID, MintAllowance<T>>, 
        /// Mutable privileged role addresses
        roles: Roles<T>,
    }

    /// An object representing the ability to mint up to an allowance 
    /// specified in the Treasury. 
    /// The privilege can be revoked by the master minter.
    public struct MintCap<phantom T> has key, store {
        id: UID,
    }

    /// Key for retrieving TreasuryCap stored in dynamic field
    public struct TreasuryCapKey has copy, store, drop {}
    /// Key for retrieving DenyCap stored in dynamic field
    public struct DenyCapKey has copy, store, drop {}

    // === Events ===

    public struct MintCapCreated<phantom T> has copy, drop {
        mint_cap: ID,
    }

    public struct ControllerConfigured<phantom T> has copy, drop {
        controller: address,
        mint_cap: ID,
    }

    public struct ControllerRemoved<phantom T> has copy, drop {
        controller: address,
    }
    
    public struct MinterConfigured<phantom T> has copy, drop {
        controller: address,
        mint_cap: ID,
        allowance: u64,
    }
    
    public struct MinterRemoved<phantom T> has copy, drop {
        controller: address,
        mint_cap: ID,
    }

    public struct Mint<phantom T> has copy, drop {
        mint_cap: ID,
        recipient: address,
        amount: u64,
    }

    public struct Burn<phantom T> has copy, drop {
        mint_cap: ID,
        amount: u64,
    }

    public struct Blocklisted<phantom T> has copy, drop {
        `address`: address
    }

    public struct Unblocklisted<phantom T> has copy, drop {
        `address`: address
    }

    public struct Pause<phantom T> has copy, drop {}

    public struct Unpause<phantom T> has copy, drop {}

    public struct MetadataUpdated<phantom T> has copy, drop {
        name: string::String,
        symbol: ascii::String,
        description: string::String,
        icon_url: ascii::String
    }

    // === View-only functions ===

    /// Get immutable reference to the roles
    public fun roles<T>(treasury: &Treasury<T>): &Roles<T> {
        &treasury.roles
    }

    /// Get mutable reference to the roles
    public fun roles_mut<T>(treasury: &mut Treasury<T>): &mut Roles<T> {
        &mut treasury.roles
    }

    /// Gets the corresponding MintCap ID attached to a controller address.
    /// Errors if input address is not valid controller.
    public fun get_worker<T>(treasury: &Treasury<T>, controller: address): ID {
        assert!(is_controller(treasury, controller), ENotController);
        *treasury.controllers.borrow(controller)
    }
    
    /// Gets the allowance of a mint cap object.
    /// Returns 0 if the mint cap object is not an authorized mint cap. 
    public fun mint_allowance<T>(treasury: &Treasury<T>, mint_cap: ID): u64 {
        if (!is_authorized_mint_cap(treasury, mint_cap)) return 0;
        treasury.mint_allowances.borrow(mint_cap).value()
    }

    /// Return the total number of `T`'s in circulation.
    public fun total_supply<T>(treasury: &Treasury<T>): u64 {
        treasury.borrow_treasury_cap().total_supply()
    }

    /// [Package private] ensure treasury cap exists
    public(package) fun assert_treasury_cap_exists<T>(treasury: &Treasury<T>) {
        assert!(dof::exists_with_type<_, TreasuryCap<T>>(&treasury.id, TreasuryCapKey {}), ETreasuryCapNotFound);
    }

    /// [Package private] ensure deny cap exists
    public(package) fun assert_deny_cap_exists<T>(treasury: &Treasury<T>) {
        assert!(dof::exists_with_type<_, DenyCap<T>>(&treasury.id, DenyCapKey {}), EDenyCapNotFound);
    }

    /// Check if an address is a mint controller
    fun is_controller<T>(treasury: &Treasury<T>, controller_addr: address): bool {
        treasury.controllers.contains(controller_addr)
    }

    /// Check if a mint cap ID is authorized to mint
    fun is_authorized_mint_cap<T>(treasury: &Treasury<T>, id: ID): bool {
        treasury.mint_allowances.contains(id)
    }

    // === Write functions ===

    /// Wrap `TreasuryCap` into a struct, accessible via additional capabilities
    public fun create_treasury<T>(
        treasury_cap: TreasuryCap<T>, 
        deny_cap: DenyCap<T>, 
        owner: address,
        master_minter: address,
        blocklister: address,
        pauser: address,
        metadata_updater: address,
        ctx: &mut TxContext
    ): Treasury<T> {
        let roles = roles::create_roles<T>(owner, master_minter, blocklister, pauser, metadata_updater);
        let mut treasury = Treasury {
            id: object::new(ctx),
            controllers: table::new<address, ID>(ctx),
            mint_allowances: table::new<ID, MintAllowance<T>>(ctx),
            roles,
        };
        dof::add(&mut treasury.id, TreasuryCapKey {}, treasury_cap);
        dof::add(&mut treasury.id, DenyCapKey {}, deny_cap);
        treasury
    }

    /// Configure a controller by adding it to the controller mapping, 
    public fun configure_controller<T>(
        treasury: &mut Treasury<T>, 
        controller: address, 
        mint_cap_id: ID,
        ctx: &TxContext
    ) {
        assert!(treasury.roles.master_minter() == ctx.sender(), ENotMasterMinter);
        assert!(!is_controller(treasury, controller), EControllerAlreadyConfigured);

        treasury.controllers.add(controller, mint_cap_id);
        event::emit(ControllerConfigured<T> {
            controller,
            mint_cap: mint_cap_id
        });
    }

    /// Create new MintCap object 
    public fun create_mint_cap<T>(
        treasury: &Treasury<T>, 
        ctx: &mut TxContext
    ): MintCap<T> {
        assert!(treasury.roles.master_minter() == ctx.sender(), ENotMasterMinter);
        let mint_cap = MintCap { id: object::new(ctx) };
        event::emit(MintCapCreated<T> { 
            mint_cap: object::id(&mint_cap)
        });
        mint_cap
    }

    /// Convenience function that 
    /// 1. creates a new MintCap, 
    /// 2. configures controller worker pair
    /// 3. transfer mint cap object to the intended recipient
    public fun configure_new_controller<T>(
        treasury: &mut Treasury<T>, 
        controller: address, 
        minter: address,
        ctx: &mut TxContext
    ) {
        let mint_cap = create_mint_cap(treasury, ctx);
        configure_controller(treasury, controller, object::id(&mint_cap), ctx);
        transfer::transfer(mint_cap, minter)
    }

    /// Disable a controller by removing it from the controller table
    public fun remove_controller<T>(
        treasury: &mut Treasury<T>, 
        controller: address, 
        ctx: &TxContext
    ) {
        assert!(treasury.roles.master_minter() == ctx.sender(), ENotMasterMinter);
        assert!(is_controller(treasury, controller), ENotController);

        treasury.controllers.remove(controller);
        
        event::emit(ControllerRemoved<T> {
            controller
        });
    }

    #[allow(unused_variable)]
    /// Enables the minter and sets its allowance.
    /// TODO(SPG-308): Add pause check.
    public fun configure_minter<T>(
        treasury: &mut Treasury<T>, 
        deny_list: &DenyList, 
        new_allowance: u64, 
        ctx: &TxContext
    ) {
        let controller = ctx.sender();
        let mint_cap_id = get_worker(treasury, controller);

        if (!treasury.mint_allowances.contains(mint_cap_id)) {
            let mut allowance = mint_allowance::create();
            allowance.set(new_allowance);
            treasury.mint_allowances.add(mint_cap_id, allowance);
        } else {
            treasury.mint_allowances.borrow_mut(mint_cap_id).set(new_allowance);
        };
        event::emit(MinterConfigured<T> {
            controller,
            mint_cap: mint_cap_id,
            allowance: new_allowance
        });
    }

    /// De-authorizes the controller's corresponding mint cap
    public fun remove_minter<T>(
        treasury: &mut Treasury<T>, 
        ctx: &TxContext
    ) {
        let controller = ctx.sender();
        let mint_cap_id = get_worker(treasury, controller);
        let mint_allowance = treasury.mint_allowances.remove(mint_cap_id);
        mint_allowance.destroy();
        event::emit(MinterRemoved<T> {
            controller,
            mint_cap: mint_cap_id
        });
    }
    
    /// Mints coins to a recipient address.
    /// The caller must own a MintCap, and can only mint up to its allowance
    /// TODO(SPG-308): Add pause check.
    public fun mint<T>(
        treasury: &mut Treasury<T>, 
        mint_cap: &MintCap<T>, 
        deny_list: &DenyList, 
        amount: u64, 
        recipient: address, 
        ctx: &mut TxContext
    ) {
        let mint_cap_id = object::id(mint_cap);
        assert!(is_authorized_mint_cap(treasury, mint_cap_id), ENotMinter);
        assert!(!coin::deny_list_contains<T>(deny_list, ctx.sender()), EDeniedAddress);
        assert!(!coin::deny_list_contains<T>(deny_list, recipient), EDeniedAddress);
        assert!(amount > 0, EZeroAmount);

        let mint_allowance = treasury.mint_allowances.borrow_mut(mint_cap_id);
        assert!(mint_allowance.value() >= amount, EInsufficientAllowance);

        mint_allowance.decrease(amount);

        treasury.borrow_treasury_cap_mut().mint_and_transfer(amount, recipient, ctx);
        
        event::emit(Mint<T> { 
            mint_cap: mint_cap_id, 
            recipient, 
            amount, 
        });
    }

    /// Allows a minter to burn some of its own coins.
    /// The caller must own a MintCap
    /// TODO(SPG-308): Add pause check.
    public fun burn<T>(
        treasury: &mut Treasury<T>, 
        mint_cap: &MintCap<T>, 
        deny_list: &DenyList, 
        coin: Coin<T>,
        ctx: &TxContext
    ) {
        let mint_cap_id = object::id(mint_cap);
        assert!(is_authorized_mint_cap(treasury, mint_cap_id), ENotMinter);
        assert!(!coin::deny_list_contains<T>(deny_list, ctx.sender()), EDeniedAddress);

        let amount = coin.value();
        assert!(amount > 0, EZeroAmount);

        treasury.borrow_treasury_cap_mut().burn(coin);
        event::emit(Burn<T> {
            mint_cap: mint_cap_id,
            amount
        });
    }

    /// Blocklists an address
    public fun blocklist<T>(
        treasury: &mut Treasury<T>,
        deny_list: &mut DenyList,
        addr: address,
        ctx: &mut TxContext
    ) {
        assert!(treasury.roles.blocklister() == ctx.sender(), ENotBlocklister);

        if (!coin::deny_list_contains<T>(deny_list, addr)) {
            coin::deny_list_add<T>(deny_list, treasury.borrow_deny_cap_mut(), addr, ctx);
        };
        event::emit(Blocklisted<T> {
            `address`: addr
        })
    }

    /// Unblocklists an address
    public fun unblocklist<T>(
        treasury: &mut Treasury<T>,
        deny_list: &mut DenyList,
        addr: address,
        ctx: &mut TxContext
    ) {
        assert!(treasury.roles.blocklister() == ctx.sender(), ENotBlocklister);

        if (coin::deny_list_contains<T>(deny_list, addr)) {
            coin::deny_list_remove<T>(deny_list, treasury.borrow_deny_cap_mut(), addr, ctx);
        };
        event::emit(Unblocklisted<T> {
            `address`: addr
        })
    }

    #[allow(unused_variable)]
    /// Triggers stopped state; pause all transfers
    public fun pause<T>(
        treasury: &mut Treasury<T>, 
        deny_list: &mut DenyList,
        ctx: &mut TxContext
    ) {
        assert!(treasury.roles().pauser() == ctx.sender(), ENotPauser);

        let deny_cap = treasury.borrow_deny_cap_mut();
        // TODO(SPG-308): enable global pause
        event::emit(Pause<T> {});

        assert!(false, EUnimplemented);
    }

    #[allow(unused_variable)]
    /// Restores normal state; unpause all transfers
    public fun unpause<T>(
        treasury: &mut Treasury<T>, 
        deny_list: &mut DenyList,
        ctx: &mut TxContext
    ) {
        assert!(treasury.roles().pauser() == ctx.sender(), ENotPauser);
        let deny_cap = treasury.borrow_deny_cap_mut();
        // TODO(SPG-308): enable global pause
        event::emit(Unpause<T> {});
        
        assert!(false, EUnimplemented);
    }
   
    /// Returns an immutable reference of the TreasuryCap
    fun borrow_treasury_cap<T>(treasury: &Treasury<T>): &TreasuryCap<T> {
        treasury.assert_treasury_cap_exists();
        dof::borrow(&treasury.id, TreasuryCapKey {})
    }

    /// Returns a mutable reference of the TreasuryCap
    fun borrow_treasury_cap_mut<T>(treasury: &mut Treasury<T>): &mut TreasuryCap<T> {
        treasury.assert_treasury_cap_exists();
        dof::borrow_mut(&mut treasury.id, TreasuryCapKey {})
    }

    /// Returns a mutable reference of the DenyCap
    fun borrow_deny_cap_mut<T>(treasury: &mut Treasury<T>): &mut DenyCap<T> {
        treasury.assert_deny_cap_exists();
        dof::borrow_mut(&mut treasury.id, DenyCapKey {})
    }

    /// Update coin metadata
    public entry fun update_metadata<T>(
        treasury: &Treasury<T>,
        metadata: &mut CoinMetadata<T>,
        name: string::String,
        symbol: ascii::String,
        description: string::String,
        icon_url: ascii::String,
        ctx: &TxContext
    ) {
        assert!(treasury.roles.metadata_updater() == ctx.sender(), ENotMetadataUpdater);
        treasury.borrow_treasury_cap().update_name(metadata, name);
        treasury.borrow_treasury_cap().update_symbol(metadata, symbol);
        treasury.borrow_treasury_cap().update_description(metadata, description);
        treasury.borrow_treasury_cap().update_icon_url(metadata, icon_url);
        event::emit(MetadataUpdated<T> {
            name,
            symbol,
            description,
            icon_url
        })
    }

    // === Test Only ===

    #[test_only]
    public fun get_controllers_for_testing<T>(treasury: &Treasury<T>): &Table<address, ID> {
        &treasury.controllers
    }

    #[test_only]
    public fun get_mint_allowances_for_testing<T>(treasury: &Treasury<T>): &Table<ID, MintAllowance<T>> {
        &treasury.mint_allowances
    }

    #[test_only]
    public fun get_deny_cap_for_testing<T>(treasury: &mut Treasury<T>): &mut DenyCap<T> {
        treasury.borrow_deny_cap_mut()
    }

    #[test_only]
    public fun remove_treasury_cap_for_testing<T>(treasury: &mut Treasury<T>): TreasuryCap<T> {
        dof::remove(&mut treasury.id, TreasuryCapKey {})
    }

    #[test_only]
    public fun remove_deny_cap_for_testing<T>(treasury: &mut Treasury<T>): DenyCap<T> {
        dof::remove(&mut treasury.id, DenyCapKey {})
    }

    #[test_only]
    public(package) fun create_mint_cap_created_event<T>(mint_cap: ID): MintCapCreated<T> {
        MintCapCreated { mint_cap }
    }

    #[test_only]
    public(package) fun create_controller_configured_event<T>(controller: address, mint_cap: ID): ControllerConfigured<T> {
        ControllerConfigured { controller, mint_cap }
    }

    #[test_only]
    public(package) fun create_controller_removed_event<T>(controller: address): ControllerRemoved<T> {
        ControllerRemoved { controller }
    }

    #[test_only]
    public(package) fun create_minter_configured_event<T>(controller: address, mint_cap: ID, allowance: u64): MinterConfigured<T> {
        MinterConfigured { controller, mint_cap, allowance }
    }

    #[test_only]
    public(package) fun create_minter_removed_event<T>(controller: address, mint_cap: ID): MinterRemoved<T> {
        MinterRemoved { controller, mint_cap }
    }

    #[test_only]
    public(package) fun create_mint_event<T>(mint_cap: ID, recipient: address, amount: u64): Mint<T> {
        Mint { mint_cap, recipient, amount }
    }

    #[test_only]
    public(package) fun create_burn_event<T>(mint_cap: ID, amount: u64): Burn<T> {
        Burn { mint_cap, amount }
    }

    #[test_only]
    public(package) fun create_blocklisted_event<T>(`address`: address): Blocklisted<T> {
        Blocklisted { `address` }
    }

    #[test_only]
    public(package) fun create_unblocklisted_event<T>(`address`: address): Unblocklisted<T> {
        Unblocklisted { `address` }
    }

    #[test_only]
    public(package) fun create_metadata_updated_event<T>(
        name: string::String,
        symbol: ascii::String,
        description: string::String,
        icon_url: ascii::String
    ): MetadataUpdated<T> {
        MetadataUpdated {
            name,
            symbol,
            description,
            icon_url
        }
    }
}
