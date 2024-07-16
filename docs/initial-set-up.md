# Initial set up

This guide explains the process to set up a stablecoin from scratch on the Sui blockchain.

## Set up environment

Start off by creating and funding keypairs for use in the later steps. You will need these keys:

1. Deployer Key
2. `sui_extensions` package's `UpgradeCap` Recipient
3. `stablecoin` package's `UpgradeCap` Recipient
4. One keypair for each of the "one-time witness" package's (eg `usdc`) `UpgradeCap` recipient

Instructions:

1. Set up your local environment. Fill in the `.env` file with the appropriate values.

   ```sh
   cd typescript
   cp .env.example .env
   ```

2. Set the RPC url for the network that you publishing to in the `.env` file
3. Generate keypairs. If a faucet is available for the chain, you may fund them with SUI using the script.

   ```sh
   yarn run scripts generate-keypair

   # If generation is on testnet, devnet or localnet, run the following command to fund the address with
   # SUI using the faucet
   yarn run scripts generate-keypair --prefund
   ```

4. Set the `DEPLOYER_PRIVATE_KEY` in the `.env` file

## (One-Time) Publish the `sui_extensions` package

The `sui_extensions` package should be published if it does not already exist on the chain.

Instructions:

1. Publish the `sui_extensions` package to the network.

   ```sh
   yarn run scripts deploy sui_extensions --upgrade-cap-recipient "<upgrade_cap_recipient_address>"
   ```

2. Replace the `UpgradeCap` with an `UpgradeCap<T>`. Refer to the following sources to get the necessary values:

   1. `<sui_extensions_package_id>`: The package id published in Step 1. Refer to the transaction output in the `logs/` directory to obtain this value.
   2. `<upgrade_cap_object_id>`: The object id of the `UpgradeCap` created in Step 1. Refer to the transaction output in the `logs/` directory to obtain this value.
   3. `<typed_upgrade_cap_object_id>`: The object id of the `UpgradeCap<::sui_extensions::SUI_EXTENSIONS>` created in Step 1. Refer to the transaction output in the `logs/` directory to obtain this value.

   ```sh
   yarn run scripts deposit-upgrade-cap \
      --sui-extensions-pkg-id "<sui_extensions_package_id>" \
      --upgrade-cap-object-id "<upgrade_cap_object_id>" \
      --typed-upgrade-cap-object-id "<typed_upgrade_cap_object_id>" \
      --upgrade-cap-owner-key "<upgrade_cap_recipient_priv_key>"
   ```

## (One-Time) Publish the `stablecoin` package

The `stablecoin` package should be published if it does not already exist on the chain. Run the following command to publish the package.

Instructions:

1. Publish the `stablecoin` package to the network.

   ```sh
   yarn run scripts deploy stablecoin --upgrade-cap-recipient "<upgrade_cap_recipient_address>"
   ```

2. Replace the `UpgradeCap` with an `UpgradeCap<T>`. Refer to the following sources to get the necessary values:

   1. `<sui_extensions_package_id>`: The package id of the package published in "[(One-Time) Publish the `sui_extensions` package](#one-time-publish-the-sui_extensions-package)". Refer to the transaction output in the `logs/` directory to obtain this value.
   2. `<upgrade_cap_object_id>`: The object id of the `UpgradeCap` created in Step 1. Refer to the transaction output in the `logs/` directory to obtain this value.
   3. `<typed_upgrade_cap_object_id>`: The object id of the `UpgradeCap<::stablecoin::STABLECOIN>` created in Step 1. Refer to the transaction output in the `logs/` directory to obtain this value.

   ```sh
   yarn run scripts deposit-upgrade-cap \
      --sui-extensions-pkg-id "<sui_extensions_package_id>" \
      --upgrade-cap-object-id "<upgrade_cap_object_id>" \
      --typed-upgrade-cap-object-id "<typed_upgrade_cap_object_id>" \
      --upgrade-cap-owner-key "<upgrade_cap_recipient_priv_key>"
   ```

## Publish the one-time witness (eg `usdc`) packages

Each stablecoin will have a unique "one-time witness" package that needs to be published. For example, to create USDC, you will need to publish the `usdc` package.

Instructions for each of the one-time witness package:

1. Publish the one-time-witness package (eg. `usdc`) to the network.

   ```sh
   yarn run scripts deploy usdc --upgrade-cap-recipient "<upgrade_cap_recipient_address>"
   ```

2. Replace the `UpgradeCap` with an `UpgradeCap<T>`. Refer to the following sources to get the necessary values:

   1. `<sui_extensions_package_id>`: The package id of the package published in "[(One-Time) Publish the `sui_extensions` package](#one-time-publish-the-sui_extensions-package)". Refer to the transaction output in the `logs/` directory to obtain this value.
   2. `<upgrade_cap_object_id>`: The object id of the `UpgradeCap` created in Step 1. Refer to the transaction output in the `logs/` directory to obtain this value.
   3. `<typed_upgrade_cap_object_id>`: The object id of the `UpgradeCap<::usdc::USDC>` created in Step 1. Refer to the transaction output in the `logs/` directory to obtain this value.

   ```sh
   yarn run scripts deposit-upgrade-cap \
      --sui-extensions-pkg-id "<sui_extensions_package_id>" \
      --upgrade-cap-object-id "<upgrade_cap_object_id>" \
      --typed-upgrade-cap-object-id "<typed_upgrade_cap_object_id>" \
      --upgrade-cap-owner-key "<upgrade_cap_recipient_priv_key>"
   ```
