/**
 * Copyright 2024 Circle Internet Financial, LTD. All rights reserved.
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
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { execSync } from "child_process";
import { program } from "commander";
import "dotenv/config";
import path from "path";

/**
 * Deploys a package and transfers the package UpgradeCap to upgradeCapRecipient
 *
 * @returns Transaction output
 */
export async function deploy(
  packageName: string,
  rpcUrl: string,
  deployerKey: string,
  upgradeCapRecipient: string,
  withUnpublishedDependencies = false
) {
  const client = new SuiClient({ url: rpcUrl });
  console.log(`RPC URL: ${rpcUrl}`);

  // Turn private key into keypair format
  // cuts off 1st byte as it signifies which signature type is used.
  const deployer = Ed25519Keypair.fromSecretKey(
    decodeSuiPrivateKey(deployerKey).secretKey
  );
  console.log(`Deployer: ${deployer.toSuiAddress()}`);

  console.log("Building packages...");
  const packagePath = path.join(__dirname, `../../packages/${packageName}`);
  const withUnpublishedDependenciesArg = withUnpublishedDependencies
    ? "--with-unpublished-dependencies"
    : "";
  const rawCompiledPackages = execSync(
    `sui move build --dump-bytecode-as-base64 --path ${packagePath} ${withUnpublishedDependenciesArg}`,
    { encoding: "utf-8" }
  );
  const { modules, dependencies } = JSON.parse(rawCompiledPackages);

  console.log("Deploying packages...");
  const transaction = new Transaction();

  // Command #1: Publish packages
  const upgradeCap = transaction.publish({
    modules,
    dependencies
  });

  // Command #2: Publish Transfer UpgradeCap
  transaction.transferObjects([upgradeCap], upgradeCapRecipient);

  const initialTxOutput = await client.signAndExecuteTransaction({
    signer: deployer,
    transaction
  });

  // Wait for the transaction to be available over API
  const txOutput = await client.waitForTransaction({
    digest: initialTxOutput.digest,
    options: {
      showBalanceChanges: true,
      showEffects: true,
      showEvents: true,
      showInput: true,
      showObjectChanges: true,
      showRawInput: false // too verbose
    }
  });

  console.log(txOutput);
  console.log("Deploy process complete!");
  return txOutput;
}

program
  .name("deploy")
  .description("Deploy a new Sui package")
  .argument("<package_name>", "Name of package to deploy")
  .option("-r, --rpc-url <string>", "Network RPC URL", process.env.RPC_URL)
  .option(
    "--deployer-key <string>",
    "Deployer private key",
    process.env.DEPLOYER_PRIVATE_KEY
  )
  .option(
    "--upgrade-cap-recipient <string>",
    "The address that will receive the UpgradeCap"
  )
  .action((packageName, options) => {
    deploy(
      packageName, // package name
      options.rpcUrl,
      options.deployerKey,
      options.upgradeCapRecipient
    );
  });

if (process.env.NODE_ENV !== "TESTING") {
  program.parse();
}
