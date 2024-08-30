# Upgrading the `stablecoin` Package

This guide explains the process to upgrade the `stablecoin` package to a newer
version.

## Design

The `stablecoin` package defines a core object, `Treasury<T>`, that follows the
"[Versioned shared object](https://github.com/MystenLabs/sui/blob/7187fc18171ed0f22848f36b9ae6d0f290cf2250/docs/content/concepts/sui-move-concepts/packages/upgrade.mdx?plain=1#L48)"
pattern. This limits access to the shared `Treasury<T>` object to only specific
versions of the `stablecoin` package.

This design stems from the fact that in Sui, package upgrades do not replace the
content of existing packages. Consequently, logic in old packages persists on
the network, and objects may continue to be accessed through the old package.
Using the "Versioned shared object" pattern allows for a non-destructive way to
enforce that an object can only be accessed through specific versions of the
package.

### Versioning and Version Control

- The `stablecoin` package is versioned by the integer stored in the
  `stablecoin::version_control::VERSION` constant. This constant is baked into
  the package's content during the compilation process and remains immutable
  throughout the lifecycle of a package version.
- The `Treasury<T>` object is versioned by the set of integers stored in the
  `compatible_versions` field.

Version control within the `stablecoin` package occurs by checking that the
`compatible_versions` field of an input `Treasury<T>` object contains the
package's version. This is achieved using the
`stablecoin::version_control::assert_object_version_is_compatible_with_package`
function. Only write functions are version restricted.

The culmination of these designs means that a `Treasury<T>` object with
`compatible_versions = VecSet<u64>[1, 2]` can only be written to by packages
where their `VERSION` constant is either set to `1` or `2`.

### Updating Compatible Versions

The original
"[Versioned shared object](https://github.com/MystenLabs/sui/blob/7187fc18171ed0f22848f36b9ae6d0f290cf2250/docs/content/concepts/sui-move-concepts/packages/upgrade.mdx?plain=1#L48)"
design specifies a `migrate` function that atomically swaps the shared object to
be only compatible with the new package version. This poses an issue for
downstream packages dependent on the `stablecoin` package, as an upgrade to the
`stablecoin` package also necessitates an upgrade to the downstream packages.
Without a backward compatibility period, downstream packages will not be able to
seamlessly transition to the upgraded package.

To address this, the `stablecoin` design includes the following functions:

1. `start_migration` - Adds the package to a `Treasury<T>` object's
   `compatible_versions` set, enabling the object to be compatible with both the
   old and new package versions.
2. `abort_migration` - Removes the current package from the `Treasury<T>`
   object's `compatible_versions` set, reverting the upgrade process.
3. `complete_migration` - Removes the old package from the `Treasury<T>`
   object's `compatible_versions` set, making the object accessible only through
   the new package.

## Upgrade Process

Upgrading the `stablecoin` package involves three phases:

- **Phase 1**: Developing the new package
- **Phase 2**: Publishing the new package (using the `Upgrade` command)
- **Phase 3**: Migrating the `Treasury<T>` object to be compatible only with the
  new package

### Phase 1: Developing the New Package

Apart from ensuring that the new package is compliant with the upgrade policy,
developers should:

1. Increment the version number of the package in
   `stablecoin::version::VERSION`. Ensure that this value is unique across all
   packages, and is larger than the current `Treasury<T>` object version.
2. Evaluate whether new functions should be version restricted. Note that
   leaving a function version unrestricted is a permanent decision.
3. Add any initialization logic in the `complete_migration` function.
4. Update `start_migration`, `abort_migration` and `complete_migration`
   functions as necessary to allow for a proper `Treasury<T>` state migration.

### Phase 2: Publishing the New Package

1. Publish the package using the `Upgrade` PTB flow
   ([reference](https://github.com/MystenLabs/sui/blob/7187fc18171ed0f22848f36b9ae6d0f290cf2250/docs/content/concepts/sui-move-concepts/packages/upgrade.mdx?plain=1#L1)).

### Phase 3: Migrating the `Treasury<T>` Object

1. Run the `start_migration` function.
2. Allow a backward compatibility period for downstream packages to implement
   their changes.
3. Run the `complete_migration` function.
