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
import { generateKeypairCommand } from "../../scripts/generateKeypair";
import {
  DEFAULT_GAS_BUDGET,
  getCreatedObjects,
  getPublishedPackages
} from "../../scripts/helpers";
import SuiCliWrapper from "../../scripts/helpers/suiCliWrapper";

describe("Test deploy script", () => {
  const RPC_URL = process.env.RPC_URL as string;
  const suiWrapper = new SuiCliWrapper({
    rpcUrl: RPC_URL
  });

  let deployerKeys: Ed25519Keypair;

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
    const publishedPackageIds = getPublishedPackages(deployTx);
    assert.equal(publishedPackageIds.length, 1);
  });

  after(() => {
    suiWrapper.resetPublishedAddressInPackageManifest("sui_extensions");
  });

  it("Deploys stablecoin package successfully", async () => {
    const upgraderKeys = await generateKeypairCommand({ prefund: false });

    const txOutput = await deployCommand("stablecoin", {
      rpcUrl: RPC_URL as string,
      deployerKey: deployerKeys.getSecretKey(),
      upgradeCapRecipient: upgraderKeys.toSuiAddress(),
      gasBudget: DEFAULT_GAS_BUDGET.toString()
    });

    const createdObjects = getCreatedObjects(txOutput);
    const publishedObjects = getPublishedPackages(txOutput);
    assert.equal(createdObjects.length, 2);
    assert.equal(publishedObjects.length, 1);

    const createdUpgradeCapObj = createdObjects.find(
      (c) => c.objectType === "0x2::package::UpgradeCap"
    );
    assert(createdUpgradeCapObj != null);
    assert.equal(createdUpgradeCapObj.sender, deployerKeys.toSuiAddress());
    assert.equal(
      (createdUpgradeCapObj.owner as any).AddressOwner,
      upgraderKeys.toSuiAddress()
    );
  });

  it("Should destroy UpgradeCap if makeImmutable is set", async () => {
    const upgraderKeys = await generateKeypairCommand({ prefund: false });

    const txOutput = await deployCommand("stablecoin", {
      rpcUrl: RPC_URL as string,
      deployerKey: deployerKeys.getSecretKey(),
      upgradeCapRecipient: upgraderKeys.toSuiAddress(),
      makeImmutable: true,
      gasBudget: DEFAULT_GAS_BUDGET.toString()
    });

    const createdObjects = getCreatedObjects(txOutput);
    const publishedObjects = getPublishedPackages(txOutput);
    assert.equal(createdObjects.length, 1);
    assert.equal(publishedObjects.length, 1);

    assert(
      createdObjects.find((c) => c.objectType === "0x2::package::UpgradeCap") ==
        null
    );
  });
});
