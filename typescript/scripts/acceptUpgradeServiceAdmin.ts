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

export async function acceptUpgradeServiceAdminHelper(options: {
  pendingUpgradeServiceAdminKey: string;
  upgradeServiceObjectId: string;
  rpcUrl: string;
  gasBudget?: string;
}) {
  const { pendingUpgradeServiceAdminKey, upgradeServiceObjectId, rpcUrl } =
    options;
  const gasBudget = options.gasBudget ? BigInt(options.gasBudget) : null;
  const pendingUpgradeServiceAdmin = getEd25519KeypairFromPrivateKey(
    pendingUpgradeServiceAdminKey
  );
  const suiClient = new SuiClient({ url: rpcUrl });
  const upgradeServiceClient = await UpgradeServiceClient.buildFromId(
    suiClient,
    upgradeServiceObjectId
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
  const currentAdminAddress = await upgradeServiceClient.getAdmin();
  log(
    `Accepting the pending admin for ${upgradeServiceObjectType}. The admin will be updated from ${currentAdminAddress} to ${pendingUpgradeServiceAdmin}`,
    inspectObject(upgradeServiceObject)
  );
  if (!(await waitForUserConfirmation())) {
    throw new Error("Terminating...");
  }

  // Check given upgrade service admin key is consistent with current pending admin
  const pendingAdminAddress = await upgradeServiceClient.getPendingAdmin();
  if (pendingAdminAddress !== pendingUpgradeServiceAdmin.toSuiAddress()) {
    throw new Error(
      `Incorrect private key supplied. Given private key for '${pendingUpgradeServiceAdmin.toSuiAddress()}', but expected private key for '${pendingAdminAddress}'`
    );
  }

  // Accept pending admin for upgrade service
  const txOutput = await upgradeServiceClient.acceptPendingAdmin(
    pendingUpgradeServiceAdmin,
    { gasBudget }
  );

  writeJsonOutput("accept-upgrade-service-admin", txOutput);
  log(
    "Previously pending upgrade service admin has been accepted as the new admin."
  );
}

export default program
  .createCommand("accept-upgrade-service-admin")
  .description(
    "Accept the pending upgrade service admin. Can only be called by the pending upgrade service admin."
  )
  .requiredOption(
    "--upgrade-service-object-id <string>",
    "Object id of the target upgrade service object"
  )
  .requiredOption(
    "--pending-admin-key <string>",
    "The private key of the upgrade service's pending admin"
  )
  .requiredOption(
    "-r, --rpc-url <string>",
    "Network RPC URL",
    process.env.RPC_URL
  )
  .option("--gas-budget <string>", "Gas Budget (in MIST)")
  .action(async (options) => {
    await acceptUpgradeServiceAdminHelper(options);
  });
