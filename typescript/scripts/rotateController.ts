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

import { program } from "commander";
import {
  getEd25519KeypairFromPrivateKey,
  writeJsonOutput,
  log,
  waitForUserConfirmation,
  SuiTreasuryClient,
  readTransactionOutput
} from "./helpers";
import { SuiClient } from "@mysten/sui/client";

/**
 * Rotates an existing controller to a new controller and removes the old controller.
 *
 * @returns Transaction output
 */
export async function rotateControllerHelper(
  treasuryClient: SuiTreasuryClient,
  options: {
    hotMasterMinterKey: string;
    oldControllerAddress: string;
    newControllerAddress: string;
    gasBudget?: string;
    dryRun?: boolean;
  }
) {
  log(`Dry Run: ${options.dryRun ? "enabled" : "disabled"}`);

  const { hotMasterMinterKey, oldControllerAddress, newControllerAddress } =
    options;

  const gasBudget = options.gasBudget ? BigInt(options.gasBudget) : null;
  const hotMasterMinter = getEd25519KeypairFromPrivateKey(hotMasterMinterKey);

  // Ensure that the master minter key is correct
  const { masterMinter } = await treasuryClient.getRoles();
  if (masterMinter !== hotMasterMinter.toSuiAddress()) {
    throw new Error(
      `Incorrect master minter key, given ${hotMasterMinter.toSuiAddress()}, expected ${masterMinter}`
    );
  }

  log(
    `Going to rotate the controller from ${oldControllerAddress} to ${newControllerAddress}`
  );
  if (!(await waitForUserConfirmation())) {
    throw new Error("Terminating...");
  }
  const txOutput = await treasuryClient.rotateController(
    hotMasterMinter,
    newControllerAddress,
    oldControllerAddress,
    { gasBudget, dryRun: options.dryRun }
  );

  writeJsonOutput(
    options.dryRun ? "rotate-controller-dry-run" : "rotate-controller",
    txOutput
  );

  return txOutput;
}

export default program
  .createCommand("rotate-controller")
  .description("Rotates a minter controller address")
  .option(
    "--treasury-deploy-file <string>",
    "Path to a file containing the treasury deploy output in JSON format"
  )
  .option("--treasury-object-id <string>", "The ID of the treasury object")
  .requiredOption(
    "--hot-master-minter-key <string>",
    "The private key of the treasury object's master minter"
  )
  .requiredOption(
    "--old-controller-address <string>",
    "The old controller address to be removed"
  )
  .requiredOption(
    "--new-controller-address <string>",
    "The new controller address to be added"
  )
  .requiredOption(
    "-r, --rpc-url <string>",
    "Network RPC URL",
    process.env.RPC_URL
  )
  .option("--gas-budget <string>", "Gas Budget (in MIST)")
  .option("--dry-run", "Dry runs the transaction if set")
  .action(async (options) => {
    const client = new SuiClient({ url: options.rpcUrl });

    if (!options.treasuryDeployFile && !options.treasuryObjectId) {
      throw new Error(
        "Must specify one of either treasury deploy file or object ID"
      );
    }
    if (options.treasuryDeployFile && options.treasuryObjectId) {
      throw new Error(
        "Both treasury deploy file and object ID were specified. Please choose one."
      );
    }

    let treasuryClient: SuiTreasuryClient;
    if (options.treasuryObjectId) {
      treasuryClient = await SuiTreasuryClient.buildFromId(
        client,
        options.treasuryObjectId
      );
    } else {
      const deploymentTxOutput = readTransactionOutput(
        options.treasuryDeployFile
      );
      treasuryClient = SuiTreasuryClient.buildFromDeployment(
        client,
        deploymentTxOutput
      );
    }

    await rotateControllerHelper(treasuryClient, options);
  });
