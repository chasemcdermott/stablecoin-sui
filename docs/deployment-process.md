# Deployment Process

This guide explains the process to set up the packages from scratch on the Sui
blockchain.

## Set Up Environment

Start by creating keypairs for use in later steps. You will need a key for each
of these roles:

1. Deployer
2. `stablecoin` package's `UpgradeService` Admin
3. `usdc` package's `UpgradeService` Admin
4. USDC Master Minter
5. USDC Blocklister
6. USDC Pauser
7. USDC MetadataUpdater
8. USDC Treasury Owner

You will need to fund each of the keypairs above with SUI. If the deployment is
happening on a test network, you may fund the keypairs using public test
faucets.

Store these keys in a secure location.

### Instructions

1. Set up your local environment. Fill in the `.env` file with the appropriate
   values.

   ```sh
   cd typescript
   cp .env.example .env
   ```

2. Set the RPC URL for the network that you are publishing to in the `.env`
   file.

3. Generate keypairs and optionally fund them using a test faucet.

   ```sh
   yarn run scripts generate-keypair

   # If generation is on testnet, devnet, or localnet, run the following command to fund the address with
   # SUI using the faucet
   yarn run scripts generate-keypair --prefund
   ```

4. Set the `DEPLOYER_PRIVATE_KEY` in the `.env` file.

## Publish the `sui_extensions` Package

The `sui_extensions` package should be published if it does not already exist on
the chain. In particular, this package should be made immutable (i.e., the
`UpgradeCap` should be destroyed) to ensure that no actors will be able to make
changes to any of the logic within the package.

### Instructions

1. Publish the `sui_extensions` package to the network, ensuring that it is
   immutable.

   ```sh
   yarn run scripts deploy sui_extensions --make-immutable --write-package-id
   ```

2. [Optional] Add Sui Extensions package ID to current session, to be reused.
   Refer to the transaction's output in the `logs/` directory to obtain this
   information.

   ```sh
   export SUI_EXTENSIONS_PACKAGE_ID=""
   ```

## Publish the `stablecoin` Package

The `stablecoin` package should be published if it does not already exist on the
chain. Run the following commands to publish the package.

### Instructions

1. Ensure that the `sui_extensions` package alias is set to the correct address
   in its `Move.toml` manifest file.
2. Publish the `stablecoin` package to the network.

   ```sh
   yarn run scripts deploy stablecoin \
      --upgrade-cap-recipient "$DEPLOYER_ADDRESS" \
      --write-package-id
   ```

3. Refer to the transaction's output in the `logs/` directory to obtain these
   information.

   ```sh
   export UPGRADE_CAP_OBJECT_ID=""

   # The ID of the `UpgradeService<::stablecoin::STABLECOIN>` object
   export UPGRADE_SERVICE_OBJECT_ID=""
   ```

4. Deposit the `UpgradeCap` into the shared `UpgradeService<T>`.

   ```sh
   yarn run scripts deposit-upgrade-cap \
      --sui-extensions-package-id "$SUI_EXTENSIONS_PACKAGE_ID" \
      --upgrade-cap-object-id "$UPGRADE_CAP_OBJECT_ID" \
      --upgrade-cap-owner-key "$DEPLOYER_PRIVATE_KEY" \
      --upgrade-service-object-id "$UPGRADE_SERVICE_OBJECT_ID"
   ```

5. Change the `UpgradeService<T>` admin.

   1. Start the two-step `UpgradeService<T>` admin role change.

      ```sh
      yarn run scripts change-upgrade-service-admin \
         --upgrade-service-admin-key "$DEPLOYER_PRIVATE_KEY" \
         --upgrade-service-object-id "$UPGRADE_SERVICE_OBJECT_ID" \
         --new-upgrade-service-admin "$STABLECOIN_UPGRADE_SERVICE_ADMIN"
      ```

   2. Accept the `UpgradeService<T>` admin role change.

      ```typescript
      const txb = new Transaction();
      txb.moveCall({
        target: `${suiExtensionsPackageId}::upgrade_service::accept_admin`,
        typeArguments: [`${stablecoinPackageId}::stablecoin::STABLECOIN`],
        arguments: [txb.object(upgradeServiceObjectId)],
      });
      txb.setSender(stablecoinUpgradeServiceAdmin);
      ```

## Publish the `usdc` Package

### Instructions

1. Ensure that the `sui_extensions` and `stablecoin` package aliases are set to
   the correct addresses in their respective `Move.toml` manifest files.
2. Publish the one-time-witness package (e.g., `usdc`) to the network.

   ```sh
   yarn run scripts deploy usdc --upgrade-cap-recipient "$DEPLOYER_ADDRESS"
   ```

3. Refer to the transaction's output in the `logs/` directory to obtain this
   information.

   ```sh
   export UPGRADE_CAP_OBJECT_ID=""

   # The ID of the `UpgradeService<::usdc::USDC>` object
   export UPGRADE_SERVICE_OBJECT_ID=""

   # The ID of the `Treasury<::usdc::USDC>` object
   export TREASURY_OBJECT_ID=""
   ```

4. Deposit the `UpgradeCap` into the shared `UpgradeService<T>`.

   ```sh
   yarn run scripts deposit-upgrade-cap \
      --sui-extensions-package-id "$SUI_EXTENSIONS_PACKAGE_ID" \
      --upgrade-cap-object-id "$UPGRADE_CAP_OBJECT_ID" \
      --upgrade-cap-owner-key "$DEPLOYER_PRIVATE_KEY" \
      --upgrade-service-object-id "$UPGRADE_SERVICE_OBJECT_ID"
   ```

5. Change the privileged roles for USDC's `Treasury<T>` object.

   1. Start the role change for USDC's `Treasury<T>` privileged roles.

      ```sh
      yarn run scripts rotate-privileged-roles \
         --treasury-object-id "$TREASURY_OBJECT_ID" \
         --treasury-owner-key "$DEPLOYER_PRIVATE_KEY" \
         --new-master-minter "$USDC_MASTER_MINTER" \
         --new-blocklister "$USDC_BLOCKLISTER" \
         --new-pauser "$USDC_PAUSER" \
         --new-metadata-updater "$USDC_METADATA_UPDATER" \
         --new-treasury-owner "$USDC_TREASURY_OWNER"
      ```

   2. Accept the `Treasury<T>` owner role change.

      ```typescript
      const txb = new Transaction();
      txb.moveCall({
        target: `${stablecoinPackageId}::entry::accept_ownership`,
        typeArguments: [`${usdcPackageId}::usdc::USDC`],
        arguments: [txb.object(treasuryObjectId)],
      });
      txb.setSender(usdcTreasuryOwner);
      ```

6. Change the `UpgradeService<T>` admin.

   1. Start the two-step `UpgradeService<T>` admin role change.

      ```sh
      yarn run scripts change-upgrade-service-admin \
         --upgrade-service-admin-key "$DEPLOYER_PRIVATE_KEY" \
         --upgrade-service-object-id "$UPGRADE_SERVICE_OBJECT_ID" \
         --new-upgrade-service-admin "$USDC_UPGRADE_SERVICE_ADMIN"
      ```

   2. Accept the `UpgradeService<T>` admin role change.

      ```typescript
      const txb = new Transaction();
      txb.moveCall({
        target: `${suiExtensionsPackageId}::upgrade_service::accept_admin`,
        typeArguments: [`${usdcPackageId}::usdc::USDC`],
        arguments: [txb.object(upgradeServiceObjectId)],
      });
      txb.setSender(usdcUpgradeServiceAdmin);
      ```
