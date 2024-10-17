/**
 * Copyright 2024 Circle Internet Group, Inc. All rights reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { SuiClient } from "@mysten/sui/client";
import { program } from "commander";
import {
  executeTransactionHelper,
  getEd25519KeypairFromPrivateKey,
  getPublishedPackages,
  log,
  writeJsonOutput
} from "./helpers";
import SuiCliWrapper from "./helpers/suiCliWrapper";
import { Transaction } from "@mysten/sui/transactions";

/**
 * Deploys a package and transfers the package UpgradeCap to upgradeCapRecipient
 *
 * @returns Transaction output
 */
export async function deployCommand<DryRunEnabled extends boolean = false>(
  packageName: string,
  options: {
    rpcUrl: string;
    deployerKey: string;
    upgradeCapRecipient?: string;
    withUnpublishedDependencies?: boolean;
    makeImmutable?: boolean;
    writePackageId?: boolean;
    gasBudget?: string;
    dryRun?: DryRunEnabled;
  }
) {
  log(`Dry Run: ${options.dryRun ? "enabled" : "disabled"}`);

  const client = new SuiClient({ url: options.rpcUrl });
  const suiWrapper = new SuiCliWrapper({
    rpcUrl: options.rpcUrl
  });
  log(`RPC URL: ${options.rpcUrl}`);

  const deployer = getEd25519KeypairFromPrivateKey(options.deployerKey);
  log(`Deployer: ${deployer.toSuiAddress()}`);

  log(`Building package '${packageName}'...`);
  const { modules, dependencies } = suiWrapper.buildPackage({
    packageName,
    withUnpublishedDependencies: !!options.withUnpublishedDependencies
  });

  log(`Deploying package '${packageName}'...`);
  const transaction = new Transaction();

  // Command #1: Publish packages
  const upgradeCap = transaction.publish({
    modules,
    dependencies
  });

  // Command #2: Transfer UpgradeCap / Destroy UpgradeCap
  if (!options.makeImmutable) {
    if (!options.upgradeCapRecipient) {
      throw new Error("Missing required field 'updateCapRecipient'!");
    }
    transaction.transferObjects([upgradeCap], options.upgradeCapRecipient);
  } else {
    transaction.moveCall({
      target: "0x2::package::make_immutable",
      arguments: [upgradeCap]
    });
  }

  const txOutput = await executeTransactionHelper({
    dryRun: !!options.dryRun as DryRunEnabled,
    client,
    signer: deployer,
    transaction,
    gasBudget: options.gasBudget != null ? BigInt(options.gasBudget) : null
  });

  writeJsonOutput(
    options.dryRun ? `deploy-${packageName}-dry-run` : `deploy-${packageName}`,
    txOutput
  );

  if (options.writePackageId) {
    const publishedPackageIds = getPublishedPackages(txOutput);
    if (publishedPackageIds.length != 1) {
      throw new Error("Unexpected number of package IDs published");
    }
    suiWrapper.writePublishedAddressToPackageManifest(
      packageName,
      publishedPackageIds[0].packageId
    );
  }

  log("Deploy process complete!");
  return txOutput;
}

export default program
  .createCommand("deploy")
  .description("Deploy a new Sui package")
  .argument("<package_name>", "Name of package to deploy")
  .requiredOption(
    "-r, --rpc-url <string>",
    "Network RPC URL",
    process.env.RPC_URL
  )
  .option("--gas-budget <string>", "Gas Budget (in MIST)")
  .option(
    "--upgrade-cap-recipient <string>",
    "The address that will receive the UpgradeCap, optional if --make-immutable is set"
  )
  .option("--make-immutable", "Destroys the UpgradeCap after deployment")
  .option("--dry-run", "Dry runs the transaction if set")
  .option(
    "--deployer-key <string>",
    "Deployer private key",
    process.env.DEPLOYER_PRIVATE_KEY
  )
  .option(
    "--write-package-id",
    "Write the deployed package ID to the package manifest"
  )
  .action(async (packageName, options) => {
    await deployCommand(packageName, options);
  });
