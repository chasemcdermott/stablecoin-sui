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
export async function privilegedRoleKeyRotationHelper(
    treasuryClient: SuiTreasuryClient,
    options: {
      treasuryOwnerKey: string;
      newMasterMinterKey: string;
      newBlocklisterKey: string;
      newPauserKey: string;
      newMetadataUpdaterKey: string;
      newTreasuryOwnerKey: string;
    }
  ) {
    const{
      treasuryOwnerKey,
      newMasterMinterKey,
      newBlocklisterKey,
      newPauserKey,
      newMetadataUpdaterKey,
      newTreasuryOwnerKey
    } = options;

    // Ensure owner key is correct
    const treasuryOwner = getEd25519KeypairFromPrivateKey(treasuryOwnerKey);
    const { owner } = await treasuryClient.getRoles();
    if (owner !== treasuryOwner.toSuiAddress()) {
        throw new Error(
        `Incorrect owner key, given ${treasuryOwner.toSuiAddress()}, expected ${owner}`
        );
    }

    const newMasterMinter = getEd25519KeypairFromPrivateKey(newMasterMinterKey);
    const newBlocklister = getEd25519KeypairFromPrivateKey(newBlocklisterKey);
    const newPauser = getEd25519KeypairFromPrivateKey(newPauserKey);
    const newMetadataUpdater = getEd25519KeypairFromPrivateKey(newMetadataUpdaterKey);
    const newTreasuryOwner = getEd25519KeypairFromPrivateKey(newTreasuryOwnerKey);

    // Update roles
    const txOutput = await treasuryClient.privilegedKeyRoleRotation(
        treasuryOwner,
        newMasterMinter,
        newBlocklister,
        newPauser,
        newMetadataUpdater,
        newTreasuryOwner
      );
    writeJsonOutput("priviledged-key-role-rotation", txOutput);

    log("Mint configuration complete");
}

export default program
  .createCommand("privileged-key-role-rotation")
  .description(
    "add later"
  )
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
    "--new-master-minter-key <string>",
    "add later"
  )
  .requiredOption(
    "--new-blocklister-key <string>",
    "add later"
  )
  .requiredOption(
    "--new-pauser-key <string>",
    "add later"
  )
  .requiredOption(
    "--new-metadata-updater-key <string>",
    "add later"
  )
  .requiredOption(
    "--new-treasury-owner-key <string>",
    "add later"
  )
  .requiredOption(
    "-r, --rpc-url <string>",
    "Network RPC URL",
    process.env.RPC_URL
  )
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

    privilegedRoleKeyRotationHelper(treasuryClient, options);
  });
