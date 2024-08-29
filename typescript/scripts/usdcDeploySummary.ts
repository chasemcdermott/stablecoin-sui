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

import { SuiTransactionBlockResponse } from "@mysten/sui/client";
import {
  getCreatedObjects,
  getPublishedPackages,
  log,
  readTransactionOutput
} from "./helpers";
import { program } from "commander";

export function parseUsdcDeploy(
  suiExtensionDeployOutput: SuiTransactionBlockResponse,
  stablecoinDeployOutput: SuiTransactionBlockResponse,
  usdcDeployOutput: SuiTransactionBlockResponse
) {
  return {
    packageIds: {
      suiExtensions: getSinglePublishedPackageId(suiExtensionDeployOutput),
      stablecoin: getSinglePublishedPackageId(stablecoinDeployOutput),
      usdc: getSinglePublishedPackageId(usdcDeployOutput)
    },
    objectIds: {
      stablecoinUpgradeCap: getSingleCreatedObjectId(
        stablecoinDeployOutput,
        /package::UpgradeCap/
      ),
      stablecoinUpgradeService: getSingleCreatedObjectId(
        stablecoinDeployOutput,
        /upgrade_service::UpgradeService<\w{66}::\w*::\w*>/
      ),
      usdcUpgradeCap: getSingleCreatedObjectId(
        usdcDeployOutput,
        /package::UpgradeCap/
      ),
      usdcUpgradeService: getSingleCreatedObjectId(
        usdcDeployOutput,
        /upgrade_service::UpgradeService<\w{66}::\w*::\w*>/
      ),
      usdcTreasury: getSingleCreatedObjectId(
        usdcDeployOutput,
        /treasury::Treasury<\w{66}::\w*::\w*>/
      ),
      usdcTreasuryCap: getSingleCreatedObjectId(
        usdcDeployOutput,
        /coin::TreasuryCap<\w{66}::\w*::\w*>/
      ),
      usdcDenyCapV2: getSingleCreatedObjectId(
        usdcDeployOutput,
        /coin::DenyCapV2<\w{66}::\w*::\w*>/
      ),
      usdcCoinMetadata: getSingleCreatedObjectId(
        usdcDeployOutput,
        /coin::CoinMetadata<\w{66}::\w*::\w*>/
      ),
      usdcRegulatedCoinMetadata: getSingleCreatedObjectId(
        usdcDeployOutput,
        /coin::RegulatedCoinMetadata<\w{66}::\w*::\w*>/
      )
    }
  };
}

function getSinglePublishedPackageId(txOutput: SuiTransactionBlockResponse) {
  const published = getPublishedPackages(txOutput);
  if (published.length != 1) {
    throw new Error(`Expected 1 published package, found ${published.length}.`);
  }
  return published[0].packageId;
}

function getSingleCreatedObjectId(
  txOutput: SuiTransactionBlockResponse,
  objectType: RegExp
) {
  const createdObjects = getCreatedObjects(txOutput, {
    objectType
  });
  if (createdObjects.length != 1) {
    throw new Error(
      `Expected 1 created object found matching '${objectType}', found ${createdObjects.length}.`
    );
  }
  return createdObjects[0].objectId;
}

export default program
  .createCommand("usdc-deploy-summary")
  .description(
    "Logs the relevant USDC deploy outputs, given the deployment transaction outputs"
  )
  .requiredOption(
    "--sui-extensions-deploy-file <string>",
    "Path to a file containing the sui_extensions deploy output in JSON format"
  )
  .requiredOption(
    "--stablecoin-deploy-file <string>",
    "Path to a file containing the stablecoin deploy output in JSON format"
  )
  .requiredOption(
    "--usdc-deploy-file <string>",
    "Path to a file containing the usdc deploy output in JSON format"
  )
  .action((options) => {
    const suiExtensionsDeployOutput = readTransactionOutput(
      options.suiExtensionsDeployFile
    );
    const stablecoinDeployOutput = readTransactionOutput(
      options.stablecoinDeployFile
    );
    const usdcDeployOutput = readTransactionOutput(options.usdcDeployFile);
    const outputs = parseUsdcDeploy(
      suiExtensionsDeployOutput,
      stablecoinDeployOutput,
      usdcDeployOutput
    );

    log("===== Published Packages =====");
    log(`Sui Extensions Package: ${outputs.packageIds.suiExtensions}`);
    log(`Stablecoin Package: ${outputs.packageIds.stablecoin}`);
    log(`USDC Package: ${outputs.packageIds.usdc}`);

    log("");
    log("===== Stablecoin Objects =====");
    log(`Stablecoin UpgradeCap: ${outputs.objectIds.stablecoinUpgradeCap}`);
    log(
      `Stablecoin UpgradeService: ${outputs.objectIds.stablecoinUpgradeService}`
    );

    log("");
    log("===== USDC Objects =====");
    log(`USDC UpgradeCap: ${outputs.objectIds.usdcUpgradeCap}`);
    log(`USDC UpgradeService: ${outputs.objectIds.usdcUpgradeService}`);
    log(`USDC Treasury: ${outputs.objectIds.usdcTreasury}`);
    log(`USDC TreasuryCap: ${outputs.objectIds.usdcTreasuryCap}`);
    log(`USDC DenyCapV2: ${outputs.objectIds.usdcDenyCapV2}`);
    log(`USDC CoinMetadata: ${outputs.objectIds.usdcCoinMetadata}`);
    log(
      `USDC RegulatedCoinMetadata: ${outputs.objectIds.usdcRegulatedCoinMetadata}`
    );
  });
