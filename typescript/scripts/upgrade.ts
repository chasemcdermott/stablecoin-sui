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
  getPublishedPackages,
  log,
  waitForUserConfirmation,
  writeJsonOutput
} from "./helpers";
import UpgradeServiceClient from "./helpers/upgradeServiceClient";
import { SuiClient } from "@mysten/sui/client";
import SuiWrapper from "./helpers/suiWrapper";

export async function upgradeHelper(
  upgradeServiceClient: UpgradeServiceClient,
  suiWrapper: SuiWrapper,
  packageName: string,
  options: {
    adminKey: string;
    gasBudget?: string;
    withUnpublishedDependencies?: boolean
  }
) {
  const admin = getEd25519KeypairFromPrivateKey(options.adminKey);
  const currentAdminAddress = await upgradeServiceClient.getAdmin();
  if (currentAdminAddress != admin.toSuiAddress()) {
    throw new Error(
      `Key with address ${admin.toSuiAddress()} is not the current admin for UpgradeService<${upgradeServiceClient.upgradeServiceOtwType}>`
    );
  }

  log("Building package");
  const { modules, dependencies, digest } = suiWrapper.buildPackage({
    packageName,
    withUnpublishedDependencies: !!options.withUnpublishedDependencies
  });

  // Use the latest published package ID, not the original.
  const latestPackageId = await upgradeServiceClient.getUpgradeCapPackageId();
  log(
    `Going to deploy package upgrade for ${packageName} with latest packageId ${latestPackageId}`
  );
  log(`Verify that package upgrade has digest ${digest}`);
  if (!(await waitForUserConfirmation())) {
    throw new Error("Terminating...");
  }

  const gasBudget = options.gasBudget ? BigInt(options.gasBudget) : null;
  const upgradeTxOutput = await upgradeServiceClient.upgrade(
    admin,
    latestPackageId,
    modules,
    dependencies,
    digest,
    { gasBudget }
  );

  writeJsonOutput("upgrade", upgradeTxOutput);

  const published = getPublishedPackages(upgradeTxOutput);
  if (published.length != 1) {
    throw new Error(
      `Expected one published package but found ${published.length}`
    );
  }
  log(`New Package ID: ${published[0].packageId}`);

  return upgradeTxOutput;
}

export default program
  .createCommand("upgrade")
  .description("Upgrade the given package ID")
  .argument("<packageName>", "The name of the package to upgrade")
  .requiredOption(
    "--upgrade-service-object-id <string>",
    "Object id of the target upgrade service object"
  )
  .requiredOption(
    "--admin-key <string>",
    "The private key of the upgrade service's pending admin"
  )
  .requiredOption(
    "-r, --rpc-url <string>",
    "Network RPC URL",
    process.env.RPC_URL
  )
  .option("--gas-budget <string>", "Gas Budget (in MIST)")
  .action(async (packageName, options) => {
    const client = new SuiClient({ url: options.rpcUrl });
    const upgradeServiceClient = await UpgradeServiceClient.buildFromId(
      client,
      options.upgradeServiceObjectId
    );
    const suiWrapper = new SuiWrapper({ rpcUrl: options.rpcUrl });
    await upgradeHelper(upgradeServiceClient, suiWrapper, packageName, options);
  });
