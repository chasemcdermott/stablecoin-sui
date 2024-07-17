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

import { bcs } from "@mysten/sui/bcs";
import {
  SuiClient,
  SuiObjectChangeCreated,
  SuiObjectChangePublished
} from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { strict as assert } from "assert";
import { execSync } from "child_process";
import { deployCommand } from "../scripts/deploy";
import { generateKeypairCommand } from "../scripts/generateKeypair";
import {
  buildPackageHelper,
  callViewFunction,
  executeTransactionHelper
} from "../scripts/helpers";

describe("Test v1 -> v2 upgrade flow", () => {
  const GAS_BUDGET = 1_000_000_000;
  const RPC_URL = process.env.RPC_URL as string;

  let client: SuiClient;
  let deployerKeys: Ed25519Keypair;
  let monoUsdcPackageId: string;
  let upgradeCapId: string;
  let typedUpgradeCapId: string;
  let treasuryId: string;

  beforeEach(async () => {
    client = new SuiClient({ url: RPC_URL });
    deployerKeys = await generateKeypairCommand(true);

    console.log(">>> Deploying a consolidated usdc package");
    const usdcDeployTxOutput = await deployCommand(
      "usdc",
      RPC_URL,
      deployerKeys.getSecretKey(),
      deployerKeys.toSuiAddress(),
      true /* with unpublished dependencies */
    );

    console.log(">>> Parsing the transaction output to get ids");
    const published =
      usdcDeployTxOutput.objectChanges?.filter(
        (c): c is SuiObjectChangePublished => c.type === "published"
      ) || [];
    assert.equal(published.length, 1);
    monoUsdcPackageId = published[0].packageId;

    const created =
      usdcDeployTxOutput.objectChanges?.filter(
        (c): c is SuiObjectChangeCreated => c.type === "created"
      ) || [];

    const upgradeCaps = created.filter(
      (c) => c.objectType === "0x2::package::UpgradeCap"
    );
    assert.equal(upgradeCaps.length, 1);
    upgradeCapId = upgradeCaps[0].objectId;

    const typedUpgradeCaps = created.filter(
      (c) =>
        c.objectType ===
        `${monoUsdcPackageId}::typed_upgrade_cap::UpgradeCap<${monoUsdcPackageId}::stablecoin::STABLECOIN>`
    );
    assert.equal(typedUpgradeCaps.length, 1);
    typedUpgradeCapId = typedUpgradeCaps[0].objectId;

    const treasury = created.filter(
      (c) =>
        c.objectType ===
        `${monoUsdcPackageId}::treasury::Treasury<${monoUsdcPackageId}::usdc::USDC>`
    );
    assert.equal(treasury.length, 1);
    treasuryId = treasury[0].objectId;

    console.log(">>> IDs found:", {
      monoUsdcPackageId,
      upgradeCapId,
      typedUpgradeCapId,
      treasuryId
    });

    console.log(">>> Deposit upgradeCap into typedUpgradeCap");
    const depositTx = new Transaction();
    depositTx.moveCall({
      target: `${monoUsdcPackageId}::typed_upgrade_cap::deposit`,
      typeArguments: [`${monoUsdcPackageId}::stablecoin::STABLECOIN`],
      arguments: [
        depositTx.object(typedUpgradeCapId),
        depositTx.object(upgradeCapId)
      ]
    });
    depositTx.setGasBudget(GAS_BUDGET);
    await executeTransactionHelper({
      client,
      signer: deployerKeys,
      transaction: depositTx
    });

    console.log(">>> Update source code to stablecoin v2");
    execSync(`cd .. && git apply packages/stablecoin/examples/v2_base.patch`);
  });

  afterEach(() => {
    console.log(">>> Reverting source code to stablecoin v1");
    execSync(
      `cd .. && git apply -R packages/stablecoin/examples/v2_base.patch`
    );
  });

  it("should successfully upgrade from v1 to v2, and migrate to v2", async () => {
    console.log(">>> Building stablecoin v2");
    const { modules, dependencies, digest } = buildPackageHelper({
      packageName: "usdc",
      withUnpublishedDependencies: true
    });

    console.log(">>> Upgrading stablecoin package...");
    const upgradeTx = new Transaction();

    const [compatiblePolicyRef] = upgradeTx.moveCall({
      target: "0x2::package::compatible_policy"
    });

    const [upgradeTicket] = upgradeTx.moveCall({
      target: `${monoUsdcPackageId}::typed_upgrade_cap::authorize_upgrade`,
      typeArguments: [`${monoUsdcPackageId}::stablecoin::STABLECOIN`],
      arguments: [
        upgradeTx.object(typedUpgradeCapId),
        compatiblePolicyRef,
        upgradeTx.makeMoveVec({
          type: "u8",
          elements: digest.map((byte) => upgradeTx.pure.u8(byte))
        })
      ]
    });

    const [upgradeReceipt] = upgradeTx.upgrade({
      modules,
      dependencies,
      package: monoUsdcPackageId,
      ticket: upgradeTicket
    });

    upgradeTx.moveCall({
      target: `${monoUsdcPackageId}::typed_upgrade_cap::commit_upgrade`,
      typeArguments: [`${monoUsdcPackageId}::stablecoin::STABLECOIN`],
      arguments: [upgradeTx.object(typedUpgradeCapId), upgradeReceipt]
    });

    upgradeTx.setGasBudget(GAS_BUDGET);
    const upgradeTxOutput = await executeTransactionHelper({
      client,
      signer: deployerKeys,
      transaction: upgradeTx
    });

    const published =
      upgradeTxOutput.objectChanges?.filter(
        (c): c is SuiObjectChangePublished => c.type === "published"
      ) || [];
    assert.equal(published.length, 1);
    monoUsdcPackageId = published[0].packageId;

    console.log(">>> New package id:", monoUsdcPackageId);

    console.log(">>> Starting migration...");
    const startMigrationTx = new Transaction();
    startMigrationTx.moveCall({
      target: `${monoUsdcPackageId}::treasury::start_migration`,
      typeArguments: [`${monoUsdcPackageId}::usdc::USDC`],
      arguments: [startMigrationTx.object(treasuryId)]
    });
    startMigrationTx.setGasBudget(GAS_BUDGET);
    await executeTransactionHelper({
      client,
      signer: deployerKeys,
      transaction: startMigrationTx
    });

    console.log(">>> Completing migration...");
    const completeMigrationTx = new Transaction();
    completeMigrationTx.moveCall({
      target: `${monoUsdcPackageId}::treasury::complete_migration`,
      typeArguments: [`${monoUsdcPackageId}::usdc::USDC`],
      arguments: [completeMigrationTx.object(treasuryId)]
    });
    completeMigrationTx.setGasBudget(GAS_BUDGET);
    await executeTransactionHelper({
      client,
      signer: deployerKeys,
      transaction: completeMigrationTx
    });

    console.log(">>> Checking compatible_versions ...");
    const checkCompatibleVersionsTx = new Transaction();
    checkCompatibleVersionsTx.moveCall({
      target: `${monoUsdcPackageId}::treasury::compatible_versions`,
      typeArguments: [`${monoUsdcPackageId}::usdc::USDC`],
      arguments: [checkCompatibleVersionsTx.object(treasuryId)]
    });
    checkCompatibleVersionsTx.setGasBudget(GAS_BUDGET);
    const [compatibleVersions] = await callViewFunction({
      client,
      transaction: checkCompatibleVersionsTx,
      returnTypes: [bcs.vector(bcs.U64)]
    });

    assert.deepStrictEqual(compatibleVersions, ["2"]);
  });
});
