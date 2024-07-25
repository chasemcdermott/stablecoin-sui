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
import { Transaction } from "@mysten/sui/transactions";
import { strict as assert } from "assert";
import { program } from "commander";
import {
  executeTransactionHelper,
  getEd25519KeypairFromPrivateKey,
  inspectObject,
  log,
  waitForUserConfirmation,
  writeJsonOutput
} from "./helpers";

export async function depositUpgradeCapCommand(options: {
  rpcUrl: string;
  suiExtensionsPackageId: string;
  upgradeCapObjectId: string;
  upgradeCapOwnerKey: string;
  upgradeServiceObjectId: string;
}) {
  const client = new SuiClient({ url: options.rpcUrl });
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

  assert(
    upgradeServiceInfo.data?.content?.dataType == "moveObject",
    "Expected 'moveObject' field but is missing!"
  );

  const typeArgument = upgradeServiceInfo.data.content.type.match(
    /(?<=UpgradeService<)\w{66}::\w*::\w*(?=>)/
  )?.[0];
  assert(
    typeArgument != null,
    "Expected typeArgument to be found but is missing or empty! Value: " +
      typeArgument
  );

  log(
    `Storing UpgradeCap of id '${options.upgradeCapObjectId}' in UpgradeService<${typeArgument}> of id '${options.upgradeServiceObjectId}'...`
  );

  const transaction = new Transaction();

  // Command #1: Deposit UpgradeCap into UpgradeService<T>
  transaction.moveCall({
    target: `${options.suiExtensionsPackageId}::upgrade_service::deposit`,
    typeArguments: [typeArgument],
    arguments: [
      transaction.object(options.upgradeServiceObjectId),
      transaction.object(options.upgradeCapObjectId)
    ]
  });

  const transactionOutput = await executeTransactionHelper({
    client,
    signer: upgradeCapOwner,
    transaction
  });

  writeJsonOutput("deposit-upgrade-cap", transactionOutput);
  log(`Deposited UpgradeCap into UpgradeService<${typeArgument}> !`);

  return transactionOutput;
}

export default program
  .createCommand("deposit-upgrade-cap")
  .description("Deposit an UpgradeCap in an UpgradeService<T>")
  .requiredOption(
    "--sui-extensions-package-id <string>",
    "The package id for sui_extensions"
  )
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
  .option("-r, --rpc-url <string>", "Network RPC URL", process.env.RPC_URL)
  .action((options) => {
    depositUpgradeCapCommand(options);
  });
