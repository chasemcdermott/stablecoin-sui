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
    use sui::coin::{Self, Coin, TreasuryCap, DenyCap};
    use sui::deny_list::{DenyList};
    use sui::event;
    use sui::table::{Self, Table};
    use stablecoin::mint_allowance::{Self, MintAllowance};
    use stablecoin::roles::{Self, Roles};

    // === Errors ===

    const EControllerAlreadyConfigured: u64 = 0;
    const EDeniedAddress: u64 = 1;
    const EInsufficientAllowance: u64 = 2;
    const ENotAdmin: u64 = 3;
    const ENotController: u64 = 4;
    const ENotMinter: u64 = 5;
    const EZeroAddress: u64 = 6;
    const EZeroAmount: u64 = 7;

    // === Structs ===

    /// A Treasury of type `T` that stores a TreasuryCap object 
    /// and additional configurations related to minting and burning.
    public struct Treasury<phantom T> has key, store {
        id: UID,
        /// TreasuryCap of the same type `T`
        treasury_cap: TreasuryCap<T>,
        /// DenyCap of the same type `T`
        deny_cap: DenyCap<T>,
        /// Mapping between controllers and mint cap addresses
        controllers: Table<address, address>,
        /// Mapping between mint cap addresses and mint allowances
        mint_allowances: Table<address, MintAllowance<T>>, 
        /// Mutable privileged role addresses
        roles: Roles,
    }

    /// An object representing the ability to mint up to an allowance 
    /// specified in the Treasury. 
    /// The privilege can be revoked by the treasury admin.
    public struct MintCap<phantom T> has key, store {
        id: UID,
    }

    // === Events ===

    public struct MintCapCreated has copy, drop {
        mint_cap: address,
    }

    public struct ControllerConfigured has copy, drop {
        controller: address,
        mint_cap: address,
    }

    public struct ControllerRemoved has copy, drop {
        controller: address,
    }
    
    public struct MinterConfigured has copy, drop {
        controller: address,
        mint_cap: address,
        allowance: u64,
    }
    
    public struct MinterRemoved has copy, drop {
        controller: address,
        mint_cap: address,
    }

    public struct Mint has copy, drop {
        mint_cap: address,
        recipient: address,
        amount: u64,
    }

    public struct Burn has copy, drop {
        mint_cap: address,
        amount: u64,
    }

    // === View-only functions ===

    /// Get immutable reference to the roles
    public fun roles<T>(treasury: &Treasury<T>): &Roles {
        &treasury.roles
    }

    /// Get mutable reference to the roles
    public fun roles_mut<T>(treasury: &mut Treasury<T>): &mut Roles {
        &mut treasury.roles
    }

    /// Gets the corresponding MintCap address at address controller.
    /// Errors if input address is not valid controller.
    public fun get_worker<T>(treasury: &Treasury<T>, controller: address): address {
        assert!(is_controller(treasury, controller), ENotController);
        *treasury.controllers.borrow(controller)
    }
    
    /// Gets the allowance of a mint cap object address.
    /// Returns 0 if mint cap object address is not an authorized mint cap. 
    public fun mint_allowance<T>(treasury: &Treasury<T>, addr: address): u64 {
        if (!is_authorized_mint_cap(treasury, addr)) return 0;
        treasury.mint_allowances.borrow(addr).value()
    }

    /// Return the total number of `T`'s in circulation.
    public fun total_supply<T>(treasury: &Treasury<T>): u64 {
        coin::total_supply(&treasury.treasury_cap)
    }

    /// Check if an address is a mint controller
    fun is_controller<T>(treasury: &Treasury<T>, controller_addr: address): bool {
        treasury.controllers.contains(controller_addr)
    }

    /// Check if a mint cap address is authorized to mint
    fun is_authorized_mint_cap<T>(treasury: &Treasury<T>, addr: address): bool {
        treasury.mint_allowances.contains(addr)
    }

    // === Write functions ===

    /// Wrap `TreasuryCap` into a struct, accessible via additional capabilities
    public fun create_treasury<T>(
        treasury_cap: TreasuryCap<T>, 
        deny_cap: DenyCap<T>, 
        admin: address,
        owner: address,
        blocklister: address,
        pauser: address,
        ctx: &mut TxContext

    ): Treasury<T> {
        let roles = roles::create_roles(admin, owner, blocklister, pauser);

        Treasury {
            id: object::new(ctx),
            treasury_cap,
            deny_cap,
            controllers: table::new<address, address>(ctx),
            mint_allowances: table::new<address, MintAllowance<T>>(ctx),
            roles,
        }
    }

    /// Configure a controller by adding it to the controller mapping, 
    public fun configure_controller<T>(
        treasury: &mut Treasury<T>, 
        controller: address, 
        mint_cap_addr: address,
        ctx: &TxContext
    ) {
        assert!(treasury.roles.admin() == ctx.sender(), ENotAdmin);
        assert!(controller != @0x0, EZeroAddress);
        assert!(!is_controller(treasury, controller), EControllerAlreadyConfigured);

        treasury.controllers.add(controller, mint_cap_addr);
        event::emit(ControllerConfigured { controller, mint_cap: mint_cap_addr });
    }

    /// Create new MintCap object 
    public fun create_mint_cap<T>(
        treasury: &Treasury<T>, 
        ctx: &mut TxContext
    ): MintCap<T> {
        assert!(treasury.roles.admin() == ctx.sender(), ENotAdmin);
        let mint_cap = MintCap { id: object::new(ctx) };
        event::emit(MintCapCreated { mint_cap: object::id_address(&mint_cap) });
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
        configure_controller(treasury, controller, object::id_address(&mint_cap), ctx);
        transfer::transfer(mint_cap, minter)
    }

    /// Disable a controller by removing it from the controller table
    public fun remove_controller<T>(
        treasury: &mut Treasury<T>, 
        controller: address, 
        ctx: &TxContext
    ) {
        assert!(treasury.roles.admin() == ctx.sender(), ENotAdmin);
        assert!(controller != @0x0, EZeroAddress);
        assert!(is_controller(treasury, controller), ENotController);

        treasury.controllers.remove(controller);
        
        event::emit(ControllerRemoved { controller });
    }

    /// Enables the minter and sets its allowance.
    /// TODO(SPG-270): Add pause check.
    public fun configure_minter<T>(
        treasury: &mut Treasury<T>, 
        new_allowance: u64, 
        ctx: &TxContext
    ) {
        let controller = ctx.sender();
        let mint_cap_addr = get_worker(treasury, controller);

        if (!treasury.mint_allowances.contains(mint_cap_addr)) {
            let mut allowance = mint_allowance::create();
            allowance.set(new_allowance);
            treasury.mint_allowances.add(mint_cap_addr, allowance);
        } else {
            treasury.mint_allowances.borrow_mut(mint_cap_addr).set(new_allowance);
        };
        event::emit(MinterConfigured { controller, mint_cap: mint_cap_addr, allowance: new_allowance });
    }

    /// De-authorizes the controller's corresponding mint cap
    public fun remove_minter<T>(
        treasury: &mut Treasury<T>, 
        ctx: &TxContext
    ) {
        let controller = ctx.sender();
        let mint_cap_addr = get_worker(treasury, controller);
        let mint_allowance = treasury.mint_allowances.remove(mint_cap_addr);
        mint_allowance.destroy();
        event::emit(MinterRemoved { controller, mint_cap: mint_cap_addr });
    }
    
    /// Mints coins to a recipient address.
    /// The caller must own a MintCap, and can only mint up to its allowance
    /// TODO(SPG-270): Add pause check.
    public fun mint<T>(
        treasury: &mut Treasury<T>, 
        mint_cap: &MintCap<T>, 
        deny_list: &DenyList, 
        amount: u64, 
        recipient: address, 
        ctx: &mut TxContext
    ) {
        let mint_cap_addr = object::id_address(mint_cap);
        assert!(is_authorized_mint_cap(treasury, mint_cap_addr), ENotMinter);
        assert!(!coin::deny_list_contains<T>(deny_list, ctx.sender()), EDeniedAddress);
        assert!(!coin::deny_list_contains<T>(deny_list, recipient), EDeniedAddress);
        assert!(recipient != @0x0, EZeroAddress);
        assert!(amount > 0, EZeroAmount);

        let mint_allowance = treasury.mint_allowances.borrow_mut(mint_cap_addr);
        assert!(mint_allowance.value() >= amount, EInsufficientAllowance);

        mint_allowance.decrease(amount);

        coin::mint_and_transfer(&mut treasury.treasury_cap, amount, recipient, ctx);
        
        event::emit(Mint { 
            mint_cap: mint_cap_addr, 
            recipient, 
            amount, 
        });
    }

    /// Allows a minter to burn some of its own coins.
    /// The caller must own a MintCap
    /// TODO(SPG-270): Add pause check.
    public fun burn<T>(
        treasury: &mut Treasury<T>, 
        mint_cap: &MintCap<T>, 
        deny_list: &DenyList, 
        coin: Coin<T>,
        ctx: &TxContext
    ) {
        let mint_cap_addr = object::id_address(mint_cap);
        assert!(is_authorized_mint_cap(treasury, mint_cap_addr), ENotMinter);
        assert!(!coin::deny_list_contains<T>(deny_list, ctx.sender()), EDeniedAddress);

        let amount = coin.value();
        assert!(amount > 0, EZeroAmount);

        coin::burn(&mut treasury.treasury_cap, coin);
        event::emit(Burn { mint_cap: mint_cap_addr, amount });
    }

    // === Test Only ===

    #[test_only]
    public fun get_controllers_for_testing<T>(treasury: &Treasury<T>): &Table<address, address> {
        &treasury.controllers
    }

    #[test_only]
    public fun get_mint_allowances_for_testing<T>(treasury: &Treasury<T>): &Table<address, MintAllowance<T>> {
        &treasury.mint_allowances
    }

    #[test_only]
    public fun get_deny_cap_for_testing<T>(treasury: &mut Treasury<T>): &mut DenyCap<T> {
        &mut treasury.deny_cap
    }
}
