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

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { strict as assert } from "assert";
import { deployCommand } from "../../scripts/deploy";
import { depositUpgradeCapCommand } from "../../scripts/depositUpgradeCap";
import { generateKeypairCommand } from "../../scripts/generateKeypair";
import {
  DEFAULT_GAS_BUDGET,
  getCreatedObjects,
  getMutatedObjects,
  getPublishedPackages,
  resetPublishedAddressInPackageManifest
} from "../../scripts/helpers";

describe("Test deposit-upgrade-cap script", () => {
  const RPC_URL = process.env.RPC_URL as string;

  let deployerKeys: Ed25519Keypair;

  let suiExtensionsPackageId: string;
  let stablecoinPackageId: string;
  let stablecoinUpgradeCapId: string;
  let stablecoinUpgradeCapOwner: Ed25519Keypair;
  let stablecoinUpgradeServiceId: string;

  before("Deploy 'sui_extensions' package", async () => {
    deployerKeys = await generateKeypairCommand({ prefund: true });

    const deployTx = await deployCommand("sui_extensions", {
      rpcUrl: RPC_URL,
      deployerKey: deployerKeys.getSecretKey(),
      upgradeCapRecipient: deployerKeys.toSuiAddress(),
      writePackageId: true,
      gasBudget: DEFAULT_GAS_BUDGET.toString()
    });

    // Parse the transaction output to get the published package id
    const published = getPublishedPackages(deployTx);
    assert.equal(published.length, 1);
    suiExtensionsPackageId = published[0].packageId;
  });

  after(() => {
    resetPublishedAddressInPackageManifest("sui_extensions");
  });

  beforeEach("Deploy 'stablecoin' package", async () => {
    stablecoinUpgradeCapOwner = deployerKeys;

    const deployTx = await deployCommand("stablecoin", {
      rpcUrl: RPC_URL,
      deployerKey: deployerKeys.getSecretKey(),
      upgradeCapRecipient: stablecoinUpgradeCapOwner.toSuiAddress(),
      gasBudget: DEFAULT_GAS_BUDGET.toString()
    });

    // Parse the transaction output to get the published package id
    const published = getPublishedPackages(deployTx);
    assert.equal(published.length, 1);
    stablecoinPackageId = published[0].packageId;

    // Parse the transaction output to get the UpgradeCap's object id
    const createdUpgradeCap = getCreatedObjects(deployTx, {
      objectType: "0x2::package::UpgradeCap"
    });
    assert.equal(createdUpgradeCap.length, 1);
    stablecoinUpgradeCapId = createdUpgradeCap[0].objectId;

    // Parse the transaction output to get the UpgradeService<T>'s object id
    const createdUpgradeService = getCreatedObjects(deployTx, {
      objectType: `${suiExtensionsPackageId}::upgrade_service::UpgradeService<${stablecoinPackageId}::stablecoin::STABLECOIN>`
    });
    assert.equal(createdUpgradeService.length, 1);
    stablecoinUpgradeServiceId = createdUpgradeService[0].objectId;
  });

  it("Deposits an UpgradeCap into an UpgradeService<T> for the 'stablecoin' package correctly", async () => {
    const depositUpgradeCapTx = await depositUpgradeCapCommand({
      rpcUrl: RPC_URL,
      suiExtensionsPackageId,
      upgradeCapObjectId: stablecoinUpgradeCapId,
      upgradeCapOwnerKey: stablecoinUpgradeCapOwner.getSecretKey(),
      upgradeServiceObjectId: stablecoinUpgradeServiceId,
      gasBudget: DEFAULT_GAS_BUDGET.toString()
    });
    assert(depositUpgradeCapTx, "Missing depositUpgradeCapTx!");

    // Figure out the new owner of the UpgradeCap.
    let newStablecoinUpgradeCapOwner: string;
    {
      const stablecoinUpgradeCapChanges = getMutatedObjects(
        depositUpgradeCapTx,
        { objectId: stablecoinUpgradeCapId }
      );
      assert.equal(stablecoinUpgradeCapChanges.length, 1);

      newStablecoinUpgradeCapOwner = (
        stablecoinUpgradeCapChanges[0].owner as any
      ).ObjectOwner;
    }

    // Ensure that the UpgradeCap's owner changed.
    assert.notStrictEqual(
      newStablecoinUpgradeCapOwner,
      stablecoinUpgradeCapOwner.toSuiAddress()
    );

    // Figure out the owner of the dynamic field object that owns the UpgradeCap.
    let dynamicFieldOwner: string;
    {
      const newStablecoinUpgradeCapOwnerChanges = getCreatedObjects(
        depositUpgradeCapTx,
        { objectId: newStablecoinUpgradeCapOwner }
      );
      assert.equal(newStablecoinUpgradeCapOwnerChanges.length, 1);
      assert.equal(
        newStablecoinUpgradeCapOwnerChanges[0].objectType.includes(
          "0x2::dynamic_field::Field"
        ),
        true
      );

      dynamicFieldOwner = (newStablecoinUpgradeCapOwnerChanges[0].owner as any)
        .ObjectOwner;
    }

    // Ensure that the owner of the dynamic field is the UpgradeService<T> itself.
    assert.equal(dynamicFieldOwner, stablecoinUpgradeServiceId);
  });
});
