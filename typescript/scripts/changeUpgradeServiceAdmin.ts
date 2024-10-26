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
  waitForUserConfirmation,
  inspectObject,
  log
} from "./helpers";
import { SuiClient } from "@mysten/sui/client";
import UpgradeServiceClient from "./helpers/upgradeServiceClient";

export async function changeUpgradeServiceAdminHelper(options: {
  upgradeServiceAdminKey: string;
  upgradeServiceObjectId: string;
  newUpgradeServiceAdmin: string;
  rpcUrl: string;
  gasBudget?: string;
  dryRun?: boolean;
}) {
  log(`Dry Run: ${options.dryRun ? "enabled" : "disabled"}`);

  const suiClient = new SuiClient({ url: options.rpcUrl });
  const upgradeServiceClient = await UpgradeServiceClient.buildFromId(
    suiClient,
    options.upgradeServiceObjectId
  );

  const {
    upgradeServiceAdminKey,
    upgradeServiceObjectId,
    newUpgradeServiceAdmin
  } = options;
  const gasBudget = options.gasBudget ? BigInt(options.gasBudget) : null;
  const upgradeServiceAdmin = getEd25519KeypairFromPrivateKey(
    upgradeServiceAdminKey
  );

  // Parse out object type with given object id
  const upgradeServiceObject = await suiClient.getObject({
    id: upgradeServiceObjectId,
    options: {
      showType: true
    }
  });

  if (!upgradeServiceObject.data?.type) {
    throw new Error("Failed to retrieve upgrade service object type");
  }
  const upgradeServiceObjectType = upgradeServiceObject.data.type;

  // Get user confirmation
  log(
    `Initiating admin transfer for ${upgradeServiceObjectType} from ${upgradeServiceAdmin.toSuiAddress()} to ${newUpgradeServiceAdmin}`,
    inspectObject(upgradeServiceObject)
  );
  if (!(await waitForUserConfirmation())) {
    throw new Error("Terminating...");
  }

  // Check given upgrade service admin key is consistent with current admin
  const adminAddress = await upgradeServiceClient.getAdmin();
  if (adminAddress !== upgradeServiceAdmin.toSuiAddress()) {
    throw new Error(
      `Incorrect private key supplied. Given private key for '${upgradeServiceAdmin.toSuiAddress()}', but expected private key for '${adminAddress}'`
    );
  }

  // Change admin for upgrade service
  const txOutput = await upgradeServiceClient.changeAdmin(
    upgradeServiceAdmin,
    newUpgradeServiceAdmin,
    { gasBudget, dryRun: options.dryRun }
  );

  writeJsonOutput(
    options.dryRun
      ? "change-upgrade-service-admin-dry-run"
      : "change-upgrade-service-admin",
    txOutput
  );

  log("Upgrade service admin change complete");
}

export default program
  .createCommand("change-upgrade-service-admin")
  .description(
    "Initiate changing upgrade service admin for given upgrade service object to given address"
  )
  .requiredOption(
    "--upgrade-service-admin-key <string>",
    "The private key of the current upgrade service admin"
  )
  .requiredOption(
    "--upgrade-service-object-id <string>",
    "Object id of the target upgrade service object"
  )
  .requiredOption(
    "--new-upgrade-service-admin <string>",
    "The address where the pending admin role will be transferred"
  )
  .requiredOption(
    "-r, --rpc-url <string>",
    "Network RPC URL",
    process.env.RPC_URL
  )
  .option("--gas-budget <string>", "Gas Budget (in MIST)")
  .option("--dry-run", "Dry runs the transaction if set")
  .action(async (options) => {
    await changeUpgradeServiceAdminHelper(options);
  });
