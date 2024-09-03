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
  getEd25519KeypairFromPrivateKey,
  inspectObject,
  log,
  waitForUserConfirmation,
  writeJsonOutput
} from "./helpers";
import UpgradeServiceClient from "./helpers/upgradeServiceClient";

export async function depositUpgradeCapCommand(options: {
  rpcUrl: string;
  upgradeCapObjectId: string;
  upgradeCapOwnerKey: string;
  upgradeServiceObjectId: string;
  gasBudget?: string;
}) {
  const client = new SuiClient({ url: options.rpcUrl });
  const upgradeServiceClient = await UpgradeServiceClient.buildFromId(
    client,
    options.upgradeServiceObjectId
  );
  log("RPC URL:", options.rpcUrl);

  const upgradeCapOwner = getEd25519KeypairFromPrivateKey(
    options.upgradeCapOwnerKey
  );
  log("UpgradeCap Owner:", upgradeCapOwner.toSuiAddress());

  const upgradeServiceInfo = await client.getObject({
    id: options.upgradeServiceObjectId,
    options: {
      showContent: true,
      showOwner: true,
      showType: true
    }
  });
  log(
    `The following UpgradeService<T> will receive an UpgradeCap of id '${options.upgradeCapObjectId}'`,
    inspectObject(upgradeServiceInfo)
  );

  if (!(await waitForUserConfirmation())) {
    log("Terminating...");
    return;
  }

  const upgradeCapInfo = await client.getObject({
    id: options.upgradeCapObjectId,
    options: {
      showContent: true,
      showOwner: true,
      showType: true
    }
  });
  log(
    `The following UpgradeCap will be deposited in the UpgradeService<T> of id '${options.upgradeServiceObjectId}'`,
    inspectObject(upgradeCapInfo)
  );

  if (!(await waitForUserConfirmation())) {
    log("Terminating...");
    return;
  }

  log(
    `Storing UpgradeCap of id '${options.upgradeCapObjectId}' in UpgradeService<${upgradeServiceClient.upgradeServiceOtwType}> of id '${options.upgradeServiceObjectId}'...`
  );

  const transactionOutput = upgradeServiceClient.depositUpgradeCap(
    upgradeCapOwner,
    options.upgradeCapObjectId,
    {
      gasBudget: options.gasBudget ? BigInt(options.gasBudget) : null
    }
  );

  writeJsonOutput("deposit-upgrade-cap", transactionOutput);
  log(
    `Deposited UpgradeCap into UpgradeService<${upgradeServiceClient.upgradeServiceOtwType}> !`
  );

  return transactionOutput;
}

export default program
  .createCommand("deposit-upgrade-cap")
  .description("Deposit an UpgradeCap in an UpgradeService<T>")
  .requiredOption(
    "--upgrade-cap-object-id <string>",
    "The id of the UpgradeCap to wrap"
  )
  .requiredOption(
    "--upgrade-cap-owner-key <string>",
    "Upgrade Cap owner's private key"
  )
  .requiredOption(
    "--upgrade-service-object-id <string>",
    "The id of the UpgradeService<T> to deposit into"
  )
  .requiredOption(
    "-r, --rpc-url <string>",
    "Network RPC URL",
    process.env.RPC_URL
  )
  .option("--gas-budget <string>", "Gas Budget (in MIST)")
  .action(async (options) => {
    await depositUpgradeCapCommand(options);
  });
