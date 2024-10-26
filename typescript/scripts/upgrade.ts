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
import fs from "fs";
import {
  getEd25519KeypairFromPrivateKey,
  getPublishedPackages,
  log,
  waitForUserConfirmation,
  writeJsonOutput
} from "./helpers";
import UpgradeServiceClient from "./helpers/upgradeServiceClient";

export async function upgradeHelper(
  upgradeServiceClient: UpgradeServiceClient,
  modules: string[],
  dependencies: string[],
  digest: number[],
  options: {
    adminKey: string;
    gasBudget?: string;
    dryRun?: boolean;
  }
) {
  log(`Dry Run: ${options.dryRun ? "enabled" : "disabled"}`);

  const admin = getEd25519KeypairFromPrivateKey(options.adminKey);
  const currentAdminAddress = await upgradeServiceClient.getAdmin();
  if (currentAdminAddress != admin.toSuiAddress()) {
    throw new Error(
      `Key with address ${admin.toSuiAddress()} is not the current admin for UpgradeService<${upgradeServiceClient.upgradeServiceOtwType}>`
    );
  }

  // Use the latest published package ID, not the original.
  const latestPackageId = await upgradeServiceClient.getUpgradeCapPackageId();
  log(`Going to publish the upgraded package for packageId ${latestPackageId}`);

  log(`Verify that package upgrade has digest: `, digest);
  if (!(await waitForUserConfirmation())) {
    throw new Error("Terminating...");
  }

  const gasBudget = options.gasBudget ? BigInt(options.gasBudget) : null;
  const txOutput = await upgradeServiceClient.upgrade(
    admin,
    latestPackageId,
    modules,
    dependencies,
    digest,
    {
      gasBudget,
      dryRun: !!options.dryRun
    }
  );

  writeJsonOutput(options.dryRun ? "upgrade-dry-run" : "upgrade", txOutput);

  const published = getPublishedPackages(txOutput);
  if (published.length != 1) {
    throw new Error(
      `Expected one published package but found ${published.length}`
    );
  }
  log(`New Package ID: ${published[0].packageId}`);

  return txOutput;
}

export default program
  .createCommand("upgrade")
  .description("Publishes an upgraded version of the package at a new ID")
  .requiredOption(
    "--upgrade-service-object-id <string>",
    "Object id of the target upgrade service object"
  )
  .requiredOption(
    "--admin-key <string>",
    "The private key of the upgrade service's admin"
  )
  .requiredOption(
    "--build-artifact-filepath <string>",
    "Path to a JSON build artifact"
  )
  .requiredOption(
    "-r, --rpc-url <string>",
    "Network RPC URL",
    process.env.RPC_URL
  )
  .option("--gas-budget <string>", "Gas Budget (in MIST)")
  .option("--dry-run", "Dry runs the transaction if set")
  .action(async (options) => {
    const client = new SuiClient({ url: options.rpcUrl });
    const upgradeServiceClient = await UpgradeServiceClient.buildFromId(
      client,
      options.upgradeServiceObjectId
    );

    if (!fs.existsSync(options.buildArtifactFilepath)) {
      throw new Error(
        `Cannot find build artifact at ${options.buildArtifactFilepath}`
      );
    }

    const { modules, dependencies, digest } = JSON.parse(
      fs.readFileSync(options.buildArtifactFilepath, "utf-8")
    );

    await upgradeHelper(
      upgradeServiceClient,
      modules,
      dependencies,
      digest,
      options
    );
  });
