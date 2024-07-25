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

import { strict as assert } from "assert";
import { deployCommand } from "../../scripts/deploy";
import { generateKeypairCommand } from "../../scripts/generateKeypair";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  SuiObjectChangeCreated,
  SuiObjectChangePublished
} from "@mysten/sui/client";
import {
  resetPublishedAddressInPackageManifest,
  writePublishedAddressToPackageManifest
} from "../../scripts/helpers";

describe("Test deploy script", () => {
  let deployerKeys: Ed25519Keypair;
  let suiExtensionsPackageId: string;

  before("Deploy 'sui_extensions' package", async () => {
    deployerKeys = await generateKeypairCommand(true);

    const { objectChanges } = await deployCommand(
      "sui_extensions",
      process.env.RPC_URL as string,
      deployerKeys.getSecretKey(),
      deployerKeys.toSuiAddress()
    );

    // Parse the transaction output to get the published package id
    const published =
      objectChanges?.filter(
        (c): c is SuiObjectChangePublished => c.type === "published"
      ) || [];
    assert.equal(published.length, 1);
    suiExtensionsPackageId = published[0].packageId;
    writePublishedAddressToPackageManifest(
      "sui_extensions",
      suiExtensionsPackageId
    );
  });

  after(() => {
    resetPublishedAddressInPackageManifest("sui_extensions");
  });

  it("Deploys stablecoin package successfully", async () => {
    const upgraderKeys = await generateKeypairCommand(false);

    const txOutput = await deployCommand(
      "stablecoin",
      process.env.RPC_URL as string,
      deployerKeys.getSecretKey(),
      upgraderKeys.toSuiAddress() // upgrader address
    );

    const { objectChanges } = txOutput;
    const createdObjects =
      objectChanges?.filter(
        (c): c is SuiObjectChangeCreated => c.type === "created"
      ) || [];
    const publishedObjects =
      objectChanges?.filter(
        (c): c is SuiObjectChangePublished => c.type === "published"
      ) || [];
    assert.equal(createdObjects.length, 2);
    assert.equal(publishedObjects.length, 1);

    const createdUpgradeCapObj = createdObjects.filter(
      (c) => c.objectType === "0x2::package::UpgradeCap"
    )[0];
    assert(createdUpgradeCapObj != null);
    assert.equal(createdUpgradeCapObj.sender, deployerKeys.toSuiAddress());
    assert.equal(
      (createdUpgradeCapObj.owner as any).AddressOwner,
      upgraderKeys.toSuiAddress()
    );
  });
});
