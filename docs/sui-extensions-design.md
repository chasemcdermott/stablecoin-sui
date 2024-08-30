# `sui_extensions` Package Design

`sui_extensions` is a utility package that contains two components:

1. [`two_step_role.move`](../packages/sui_extensions/sources/two_step_role.move)
2. [`upgrade_service.move`](../packages/sui_extensions/sources/upgrade_service.move)

It is imported as a dependency in both the `stablecoin` and `usdc` packages for
access to these utility components. Other packages may also import this package
for access to these utility components.

This package is published immutably, allowing the code of the modules to remain
static.

## `two_step_role` Module Design

The `two_step_role` module is inspired by OpenZeppelin's
[Ownable2Step](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/access/Ownable2Step.sol)
in Solidity. It defines a type, `TwoStepRole`, that:

1. Is designed to be wrapped in fields of an object.
2. Represents an address that holds the role.

The module defines two methods, `begin_role_transfer` and `accept_role`, which
mandate that the transfer of the role to another address should happen in a
two-step process, where both the active address and pending address must
explicitly agree to the transfer. This helps to prevent common mistakes, such as
transfers of a role to incorrect addresses.

### How Should `TwoStepRole` Be Used?

To transfer the role held by one address to another:

1.  The current active address should make a transaction to
    `begin_role_transfer`, specifying the pending recipient address.
2.  The recipient address should make a transaction to `accept_role`, which
    finalizes the role transfer.

In the case of an accidentally started role transfer, the role transfer may be
reverted by:

1. Sending a transaction to `begin_role_transfer`, specifying the current admin
   address as the pending recipient.
2. Sending a transaction from the current admin address to `accept_role`, which
   resets the states in the role.

## `upgrade_service` Module Design

The `upgrade_service` module defines an object `UpgradeService<T>` that:

1. Is designed to be a shared object.
2. Custodies an `UpgradeCap`, delegating access of the capability to an admin
   address.
3. Has a type argument, where the type argument is a
   [One-Time Witness](https://docs.sui.io/concepts/sui-move-concepts/one-time-witness)
   type defined by the package that `UpgradeCap` manages.

The `upgrade_service` module defines two methods, `authorize_upgrade` and
`commit_upgrade`, that proxy calls to their `sui::package` variants. These
methods primarily append onto the existing methods by emitting indexable
`AuthorizeUpgrade<T>` and `CommitUpgrade<T>` events whenever they are called.
The presence of the type argument on the `UpgradeService<T>` allows for unique
event types to be emitted for each package that is upgraded, allowing for easy
lookup through the Sui RPCs.

### How Should `UpgradeService<T>` Be Used?

The following process assumes a package `pkg` that wishes to use the
`UpgradeService<T>`.

#### Setup

1.  Within the package, define a module of the same name `pkg` that contains a
    One-Time Witness type of the same name.
2.  Within the module, define an initialization function that (a) creates an
    `UpgradeService<T>`, (b) registers the type argument to be `pkg::pkg::PKG`,
    and (c) shares the `UpgradeService<T>`.

    1.  Note that the One-Time Witness type used for registration may be any
        One-Time Witness type in the package. However, it is recommended to
        create a module and OTW type with a name that resembles the package.
        This allows upgrade events for the package to be easily identified. For
        example, the upgrade event for the example package will have the
        signature of:
        `0x123::upgrade_service::AuthorizeUpgrade<0x234::pkg::PKG>`.

    ```move
    // Sample Code
    module pkg::pkg {
        use sui_extensions::upgrade_service;
        public struct PKG has drop {}

        fun init(witness: PKG, ctx: &mut TxContext) {
            let (upgrade_service, _) = upgrade_service::new(witness, ctx.sender() /* admin */, ctx);
            transfer::public_share_object(upgrade_service);
        }
    }
    ```

3.  Publish the package `pkg`.
    1.  An `UpgradeService<pkg::pkg::PKG>` will be created and shared, and an
        `UpgradeCap` will be created and transferred to the publisher's account.
4.  Deposit the `UpgradeCap` into the `UpgradeService<T>` by running a MoveCall
    to `sui_extensions::upgrade_service::deposit`.
    1.  Note that `UpgradeCap` deposits may only be performed before any upgrade
        happens for the package.

#### Usage

- Upgrading `pkg`
  - The requirements and the general process for upgrading a package remain the
    same as defined in Sui's
    [Upgrading Packages](https://docs.sui.io/concepts/sui-move-concepts/packages/upgrade)
    documentation.
  - However, with the `UpgradeCap` custodied in `UpgradeService<T>`, instead of
    calling `sui::package::authorize_upgrade` and
    `sui::package::commit_upgrade`, the package owner should call the
    `sui_extensions::upgrade_service` variants instead.
  - Calling these functions will emit `AuthorizeUpgrade<0x234::pkg::PKG>` and
    `CommitUpgrade<0x234::pkg::PKG>` events.
  - These events may be looked up on-chain by using the `suix_queryEvents`
    [RPC](https://docs.sui.io/sui-api-ref#suix_queryevents) and using the
    `EventType` filter.
- Changing `UpgradeService<T>` Admin
  - The existing admin may be swapped to another admin address by using the
    two-step admin transfer methods,
    `sui_extensions::upgrade_service::change_admin` and
    `sui_extensions::upgrade_service::accept_admin`.
- Extracting `UpgradeCap` from `UpgradeService<T>`
  - The `UpgradeCap` that is custodied in the `UpgradeService<T>` may be
    extracted by making a MoveCall to
    `sui_extensions::upgrade_service::extract`.
