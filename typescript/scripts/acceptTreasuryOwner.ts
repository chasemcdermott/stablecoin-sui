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
  SuiTreasuryClient,
  waitForUserConfirmation,
  readTransactionOutput,
  log
} from "./helpers";
import { SuiClient } from "@mysten/sui/client";

export async function acceptTreasuryOwnerHelper(
  treasuryClient: SuiTreasuryClient,
  options: {
    pendingOwnerKey: string;
    gasBudget?: string;
  }
) {
  const pendingOwnerKey = options.pendingOwnerKey;
  const gasBudget = options.gasBudget ? BigInt(options.gasBudget) : null;

  // Ensure pending owner key is correct
  const pendingTreasuryOwner = getEd25519KeypairFromPrivateKey(pendingOwnerKey);
  const { owner, pendingOwner } = await treasuryClient.getRoles();
  if (pendingOwner !== pendingTreasuryOwner.toSuiAddress()) {
    throw new Error(
      `Incorrect pending treasury owner key, given ${pendingTreasuryOwner.toSuiAddress()}, expected ${pendingOwner}`
    );
  }

  // Get user confirmation
  log(`Going to accept ownership transfer from ${owner} to ${pendingOwner} \n`);
  if (!(await waitForUserConfirmation())) {
    throw new Error("Terminating...");
  }

  // Update roles
  const txOutput = await treasuryClient.acceptTreasuryOwner(
    pendingTreasuryOwner,
    { gasBudget }
  );
  writeJsonOutput("accept-treasury-owner", txOutput);

  log("New treasury owner accepted");
}

export default program
  .createCommand("accept-treasury-owner")
  .description("Accept the owner role. Can only be called by the pendingOwner.")
  .option(
    "--treasury-deploy-file <string>",
    "Path to a file containing the treasury deploy output in JSON format"
  )
  .option("--treasury-object-id <string>", "The ID of the treasury object")
  .requiredOption(
    "--pending-owner-key <string>",
    "The private key of the treasury object's pending owner"
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

    await acceptTreasuryOwnerHelper(treasuryClient, options);
  });
