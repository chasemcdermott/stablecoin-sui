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
import { SuiClient } from "@mysten/sui/client";
import {
  getEd25519KeypairFromPrivateKey,
  log,
  readTransactionOutput,
  SuiTreasuryClient,
  waitForUserConfirmation,
  writeJsonOutput
} from "./helpers";

/**
 * Blocklist or unblocklist a user address
 */
export async function setBlocklistStateHelper(
  treasuryClient: SuiTreasuryClient,
  addrToBlock: string,
  options: {
    blocklisterKey: string;
    unblock?: boolean;
    gasBudget?: string;
  }
) {
  const blocklister = getEd25519KeypairFromPrivateKey(options.blocklisterKey);

  log(
    `Going to set blocklist state for '${addrToBlock}' to ${!options.unblock}...`
  );
  if (!(await waitForUserConfirmation())) {
    throw new Error("Terminating...");
  }
  const txOutput = await treasuryClient.setBlocklistState(
    blocklister,
    addrToBlock,
    !options.unblock,
    { gasBudget: options.gasBudget != null ? BigInt(options.gasBudget) : null }
  );
  writeJsonOutput(`set-blocklist-state`, txOutput);
  log(
    `Address '${addrToBlock}' is now ${options.unblock ? "unblocked" : "blocked"}!`
  );
  return txOutput;
}

export default program
  .createCommand("set-blocklist")
  .description("Add or remove an address to the blocklist")
  .argument("<address>", "Address to block or unblock")
  .requiredOption(
    "--blocklister-key <string>",
    "Blocklister private key",
    process.env.BLOCKLISTER_PRIVATE_KEY
  )
  .requiredOption(
    "-r, --rpc-url <string>",
    "Network RPC URL",
    process.env.RPC_URL
  )
  .option(
    "--treasury-deploy-file <string>",
    "Path to a file containing the treasury deploy output in JSON format"
  )
  .option("--treasury-object-id <string>", "The ID of the treasury object")
  .option("--unblock", "If this flag is set, unblocklist the address. If this flag is omitted, blocklist the address.")
  .option("--gas-budget <string>", "Gas Budget (in MIST)")
  .action(async (address, options) => {
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

    await setBlocklistStateHelper(treasuryClient, address, options);
  });
