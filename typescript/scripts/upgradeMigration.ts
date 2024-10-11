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
  log
} from "./helpers";
import { SuiClient } from "@mysten/sui/client";

export async function upgradeMigrationHelper(
  treasuryClient: SuiTreasuryClient,
  action: string,
  options: {
    newStablecoinPackageId: string;
    ownerKey: string;
    gasBudget?: string;
  }
) {
  log(`Executing migration step ${action}`);

  const ownerKey = getEd25519KeypairFromPrivateKey(options.ownerKey);
  const gasBudget = options.gasBudget ? BigInt(options.gasBudget) : null;

  // Ensure owner key is correct
  const { owner } = await treasuryClient.getRoles();
  if (owner !== ownerKey.toSuiAddress()) {
    throw new Error(
      `Incorrect treasury owner key, given ${ownerKey.toSuiAddress()}, expected ${owner}`
    );
  }

  log(`Going to run ${action}_migration`);
  if (!(await waitForUserConfirmation())) {
    throw new Error("Terminating...");
  }

  const txOutput = await treasuryClient.upgradeMigration(
    ownerKey,
    options.newStablecoinPackageId,
    action,
    { gasBudget }
  );

  writeJsonOutput("upgrade-migration", txOutput);

  log(`Migration step ${action} executed`);
}

export default program
  .createCommand("upgrade-migration")
  .description("Start, abort, or complete a Treasury migration")
  .argument(
    "<action>",
    "Upgrade migration action to be performed. Must be one of [start, abort, complete]."
  )
  .requiredOption(
    "--new-stablecoin-package-id <string>",
    "ID of the newly published stablecoin package"
  )
  .requiredOption(
    "--treasury-object-id <string>",
    "The ID of the treasury object"
  )
  .requiredOption(
    "--owner-key <string>",
    "The private key of the treasury object's owner"
  )
  .requiredOption(
    "-r, --rpc-url <string>",
    "Network RPC URL",
    process.env.RPC_URL
  )
  .option("--gas-budget <string>", "Gas Budget (in MIST)")
  .action(async (action, options) => {
    const client = new SuiClient({ url: options.rpcUrl });
    const treasuryClient = await SuiTreasuryClient.buildFromId(
      client,
      options.treasuryObjectId
    );
    await upgradeMigrationHelper(treasuryClient, action, options);
  });
