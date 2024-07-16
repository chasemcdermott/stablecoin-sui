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
import util from "util";
import {
  executeTransactionHelper,
  getEd25519KeypairFromPrivateKey,
  log,
  waitForUserConfirmation,
  writeJsonOutput
} from "./helpers";

export async function depositUpgradeCapCommand(
  rpcUrl: string,
  suiExtensionsPackageId: string,

  upgradeCapObjectId: string,
  typedUpgradeCapObjectId: string,
  upgradeCapOwnerKey: string
) {
  const client = new SuiClient({ url: rpcUrl });
  log("RPC URL:", rpcUrl);

  const upgradeCapOwner = getEd25519KeypairFromPrivateKey(upgradeCapOwnerKey);
  log("UpgradeCap Owner:", upgradeCapOwner.toSuiAddress());

  const typedUpgradeCapInfo = await client.getObject({
    id: typedUpgradeCapObjectId,
    options: {
      showContent: true,
      showOwner: true,
      showType: true
    }
  });
  log(
    `The following UpgradeCap<T> will receive an UpgradeCap of id '${upgradeCapObjectId}'`,
    util.inspect(typedUpgradeCapInfo, false, 8 /* depth */, true)
  );

  if (!(await waitForUserConfirmation())) {
    log("Terminating...");
    return;
  }

  const upgradeCapInfo = await client.getObject({
    id: upgradeCapObjectId,
    options: {
      showContent: true,
      showOwner: true,
      showType: true
    }
  });
  log(
    `The following UpgradeCap will be deposited in the UpgradeCap<T> of id '${typedUpgradeCapObjectId}'`,
    util.inspect(upgradeCapInfo, false, 8 /* depth */, true)
  );

  if (!(await waitForUserConfirmation())) {
    log("Terminating...");
    return;
  }

  assert(
    typedUpgradeCapInfo.data?.content?.dataType == "moveObject",
    "Expected 'moveObject' field but is missing!"
  );

  const typeArgument = typedUpgradeCapInfo.data.content.type.match(
    /(?<=UpgradeCap<)\w{66}::\w*::\w*(?=>)/
  )?.[0];
  assert(
    typeArgument != null,
    "Expected typeArgument to be found but is missing or empty! Value: " +
      typeArgument
  );

  log(
    `Storing UpgradeCap of id '${upgradeCapObjectId}' in UpgradeCap<${typeArgument}> of id '${typedUpgradeCapObjectId}'...`
  );

  const transaction = new Transaction();

  // Command #1: Deposit UpgradeCap into UpgradeCap<T>
  transaction.moveCall({
    target: `${suiExtensionsPackageId}::typed_upgrade_cap::deposit`,
    typeArguments: [typeArgument],
    arguments: [
      transaction.object(typedUpgradeCapObjectId),
      transaction.object(upgradeCapObjectId)
    ]
  });

  const transactionOutput = await executeTransactionHelper({
    client,
    signer: upgradeCapOwner,
    transaction
  });

  writeJsonOutput("deposit-upgrade-cap", transactionOutput);
  log(`UpgradeCap<${typeArgument}> created!`);

  return transactionOutput;
}

export default program
  .createCommand("deposit-upgrade-cap")
  .description("Deposit an UpgradeCap in an UpgradeCap<T>")
  .requiredOption(
    "--sui-extensions-pkg-id <string>",
    "The package id for sui_extensions"
  )
  .requiredOption(
    "--upgrade-cap-object-id <string>",
    "The id of the UpgradeCap to wrap"
  )
  .requiredOption(
    "--typed-upgrade-cap-object-id <string>",
    "The id of the UpgradeCap<T> to deposit into"
  )
  .requiredOption(
    "--upgrade-cap-owner-key <string>",
    "Upgrade Cap owner's private key"
  )
  .option("-r, --rpc-url <string>", "Network RPC URL", process.env.RPC_URL)
  .action((options) => {
    depositUpgradeCapCommand(
      options.rpcUrl,
      options.suiExtensionsPkgId,
      options.upgradeCapObjectId,
      options.typedUpgradeCapObjectId,
      options.upgradeCapOwnerKey
    );
  });
