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

import { program } from "commander";
import {
  getEd25519KeypairFromPrivateKey,
  writeJsonOutput,
  SuiTreasuryClient,
  waitForUserConfirmation,
  readTransactionOutput,
  log
} from "./helpers";
import { SuiClient } from "@mysten/sui/client";

/**
 * After minter configuration is done
 *
 * Update master minter (after minter configuration is done!)
 * Update pauser
 * Update blocklister (after initial blocklisting, if necessary)
 * Update metadata updater
 * Initiate treasury owner role transfer
 *
 * @returns Transaction output
 */
export async function rotatePrivilegedRolesHelper(
  treasuryClient: SuiTreasuryClient,
  options: {
    treasuryOwnerKey: string;
    newMasterMinter: string;
    newBlocklister: string;
    newPauser: string;
    newMetadataUpdater: string;
    newTreasuryOwner: string;
    gasBudget?: string;
  }
) {
  const {
    treasuryOwnerKey,
    newMasterMinter,
    newBlocklister,
    newPauser,
    newMetadataUpdater,
    newTreasuryOwner
  } = options;
  const gasBudget = options.gasBudget ? BigInt(options.gasBudget) : null;

  // Ensure owner key is correct
  const treasuryOwner = getEd25519KeypairFromPrivateKey(treasuryOwnerKey);
  const {
    owner,
    masterMinter,
    blocklister,
    pauser,
    metadataUpdater,
    pendingOwner
  } = await treasuryClient.getRoles();
  if (owner !== treasuryOwner.toSuiAddress()) {
    throw new Error(
      `Incorrect treasury owner key, given ${treasuryOwner.toSuiAddress()}, expected ${owner}`
    );
  }

  // Get user confirmation
  log(`Going to update \n 
    master minter from ${masterMinter} to ${newMasterMinter} \n 
    blocklister from ${blocklister} to ${newBlocklister} \n 
    pauser from ${pauser} to ${newPauser} \n
    metadata updater from ${metadataUpdater} to ${newMetadataUpdater} \n
    And initiate ownership transfer from ${pendingOwner} to ${newTreasuryOwner} \n`);
  if (!(await waitForUserConfirmation())) {
    throw new Error("Terminating...");
  }

  // Update roles
  const txOutput = await treasuryClient.rotatePrivilegedRoles(
    treasuryOwner,
    newMasterMinter,
    newBlocklister,
    newPauser,
    newMetadataUpdater,
    newTreasuryOwner,
    { gasBudget }
  );
  writeJsonOutput("rotate-privileged-role-key", txOutput);

  log("privileged role key rotation complete");
}

export default program
  .createCommand("rotate-privileged-roles")
  .description("Rotate privileged role keys to input addresses")
  .option(
    "--treasury-deploy-file <string>",
    "Path to a file containing the treasury deploy output in JSON format"
  )
  .option("--treasury-object-id <string>", "The ID of the treasury object")
  .requiredOption(
    "--treasury-owner-key <string>",
    "The private key of the treasury object's owner"
  )
  .requiredOption(
    "--new-master-minter <string>",
    "The address where the master minter role will be transferred"
  )
  .requiredOption(
    "--new-blocklister <string>",
    "The address where the blocklister role will be transferred"
  )
  .requiredOption(
    "--new-pauser <string>",
    "The address where the pauser role will be transferred"
  )
  .requiredOption(
    "--new-metadata-updater <string>",
    "The address where the metadata updater role will be transferred"
  )
  .requiredOption(
    "--new-treasury-owner <string>",
    "The address where the pending owner role will be transferred"
  )
  .requiredOption(
    "-r, --rpc-url <string>",
    "Network RPC URL",
    process.env.RPC_URL
  )
  .option("--gas-budget <string>", "Gas Budget (in MIST)")
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

    rotatePrivilegedRolesHelper(treasuryClient, options);
  });
