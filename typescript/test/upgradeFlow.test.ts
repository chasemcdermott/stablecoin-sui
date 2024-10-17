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
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { strict as assert } from "assert";
import { execSync } from "child_process";
import { deployCommand } from "../scripts/deploy";
import { generateKeypairCommand } from "../scripts/generateKeypair";
import {
  DEFAULT_GAS_BUDGET,
  getCreatedObjects,
  getPublishedPackages,
  SuiTreasuryClient
} from "../scripts/helpers";
import SuiCliWrapper from "../scripts/helpers/suiCliWrapper";
import UpgradeServiceClient from "../scripts/helpers/upgradeServiceClient";
import { upgradeHelper } from "../scripts/upgrade";
import { upgradeMigrationHelper } from "../scripts/upgradeMigration";

describe("Test v1 -> v2 upgrade flow", () => {
  const RPC_URL = process.env.RPC_URL as string;

  let client: SuiClient;
  let upgradeServiceClient: UpgradeServiceClient;
  let treasuryClient: SuiTreasuryClient;
  let suiWrapper: SuiCliWrapper;
  let deployerKeys: Ed25519Keypair;
  let monoUsdcPackageId: string;

  beforeEach(async () => {
    client = new SuiClient({ url: RPC_URL });
    suiWrapper = new SuiCliWrapper({ rpcUrl: RPC_URL });
    deployerKeys = await generateKeypairCommand({ prefund: true });

    // Deploying a consolidated usdc package
    const usdcDeployTxOutput = await deployCommand("usdc", {
      rpcUrl: RPC_URL,
      deployerKey: deployerKeys.getSecretKey(),
      upgradeCapRecipient: deployerKeys.toSuiAddress(),
      withUnpublishedDependencies: true,
      gasBudget: DEFAULT_GAS_BUDGET.toString()
    });

    // Parsing the transaction output to get ids
    const published = getPublishedPackages(usdcDeployTxOutput);
    assert.equal(published.length, 1);
    monoUsdcPackageId = published[0].packageId;

    const upgradeCaps = getCreatedObjects(usdcDeployTxOutput, {
      objectType: "0x2::package::UpgradeCap"
    });
    assert.equal(upgradeCaps.length, 1);
    const upgradeCapId = upgradeCaps[0].objectId;

    const stablecoinOtwType = `${monoUsdcPackageId}::stablecoin::STABLECOIN`;
    const upgradeServices = getCreatedObjects(usdcDeployTxOutput, {
      objectType: `${monoUsdcPackageId}::upgrade_service::UpgradeService<${stablecoinOtwType}>`
    });
    assert.equal(upgradeServices.length, 1);
    const upgradeServiceId = upgradeServices[0].objectId;

    const coinOtwType = `${monoUsdcPackageId}::usdc::USDC`;
    const treasury = getCreatedObjects(usdcDeployTxOutput, {
      objectType: `${monoUsdcPackageId}::treasury::Treasury<${coinOtwType}>`
    });
    assert.equal(treasury.length, 1);
    const treasuryId = treasury[0].objectId;

    upgradeServiceClient = new UpgradeServiceClient(
      client,
      upgradeServiceId,
      monoUsdcPackageId,
      stablecoinOtwType
    );
    treasuryClient = new SuiTreasuryClient(
      client,
      treasuryId,
      monoUsdcPackageId,
      coinOtwType
    );

    // Deposit upgradeCap into upgradeService
    await upgradeServiceClient.depositUpgradeCap(deployerKeys, upgradeCapId, {
      gasBudget: DEFAULT_GAS_BUDGET
    });

    // Update source code to stablecoin v2
    execSync(`cd .. && git apply packages/stablecoin/examples/v2_base.patch`);
  });

  afterEach(() => {
    // Reverting source code to stablecoin v1
    execSync(
      `cd .. && git apply -R packages/stablecoin/examples/v2_base.patch`
    );
  });

  it("should successfully upgrade from v1 to v2, and migrate to v2", async () => {
    // Building stablecoin v2
    const { modules, dependencies, digest } = suiWrapper.buildPackage({
      packageName: "usdc",
      withUnpublishedDependencies: true
    });

    // Upgrading stablecoin package...
    const upgradeTxOutput = await upgradeHelper(
      upgradeServiceClient,
      modules,
      dependencies,
      digest,
      { adminKey: deployerKeys.getSecretKey() }
    );

    const published = getPublishedPackages(upgradeTxOutput);
    assert.equal(published.length, 1);
    monoUsdcPackageId = published[0].packageId;

    // Starting migration...
    await upgradeMigrationHelper(treasuryClient, "start", {
      newStablecoinPackageId: monoUsdcPackageId,
      ownerKey: deployerKeys.getSecretKey()
    });
    assert.deepStrictEqual(await treasuryClient.getCompatibleVersions(), [
      "1",
      "2"
    ]);

    // Aborting migration...
    await upgradeMigrationHelper(treasuryClient, "abort", {
      newStablecoinPackageId: monoUsdcPackageId,
      ownerKey: deployerKeys.getSecretKey()
    });
    assert.deepStrictEqual(await treasuryClient.getCompatibleVersions(), ["1"]);

    // Starting migration again...
    await upgradeMigrationHelper(treasuryClient, "start", {
      newStablecoinPackageId: monoUsdcPackageId,
      ownerKey: deployerKeys.getSecretKey()
    });
    assert.deepStrictEqual(await treasuryClient.getCompatibleVersions(), [
      "1",
      "2"
    ]);

    // Completing migration...
    await upgradeMigrationHelper(treasuryClient, "complete", {
      newStablecoinPackageId: monoUsdcPackageId,
      ownerKey: deployerKeys.getSecretKey()
    });
    assert.deepStrictEqual(await treasuryClient.getCompatibleVersions(), ["2"]);
  });
});