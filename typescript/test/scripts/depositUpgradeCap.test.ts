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

import {
  SuiObjectChangeCreated,
  SuiObjectChangeMutated,
  SuiObjectChangePublished
} from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { strict as assert } from "assert";
import { deployCommand } from "../../scripts/deploy";
import { generateKeypairCommand } from "../../scripts/generateKeypair";
import { depositUpgradeCapCommand } from "../../scripts/depositUpgradeCap";
import {
  resetPublishedAddressInPackageManifest,
  writePublishedAddressToPackageManifest
} from "../utils";

describe("Test deposit-upgrade-cap script", () => {
  const RPC_URL = process.env.RPC_URL as string;

  let deployerKeys: Ed25519Keypair;

  let suiExtensionsPackageId: string;
  let stablecoinPackageId: string;
  let stablecoinUpgradeCapId: string;
  let stablecoinTypedUpgradeCapId: string;
  let stablecoinUpgradeCapOwner: Ed25519Keypair;

  before("Deploy 'sui_extensions' package", async () => {
    deployerKeys = await generateKeypairCommand(true);

    const { objectChanges } = await deployCommand(
      "sui_extensions",
      RPC_URL,
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

  beforeEach("Deploy 'stablecoin' package", async () => {
    stablecoinUpgradeCapOwner = deployerKeys;

    const { objectChanges } = await deployCommand(
      "stablecoin",
      RPC_URL,
      deployerKeys.getSecretKey(),
      stablecoinUpgradeCapOwner.toSuiAddress()
    );

    // Parse the transaction output to get the published package id
    const published =
      objectChanges?.filter(
        (c): c is SuiObjectChangePublished => c.type === "published"
      ) || [];
    assert.equal(published.length, 1);
    stablecoinPackageId = published[0].packageId;

    // Parse the transaction output to get the UpgradeCap's object id
    const createdUpgradeCap =
      objectChanges
        ?.filter((c): c is SuiObjectChangeCreated => c.type === "created")
        .filter((c) => c.objectType === "0x2::package::UpgradeCap") || [];
    assert.equal(createdUpgradeCap.length, 1);
    stablecoinUpgradeCapId = createdUpgradeCap[0].objectId;

    // Parse the transaction output to get the UpgradeCap<T>'s object id
    const createdTypedUpgradeCap =
      objectChanges
        ?.filter((c): c is SuiObjectChangeCreated => c.type === "created")
        .filter(
          (c) =>
            c.objectType ===
            `${suiExtensionsPackageId}::typed_upgrade_cap::UpgradeCap<${stablecoinPackageId}::stablecoin::STABLECOIN>`
        ) || [];
    assert.equal(createdTypedUpgradeCap.length, 1);
    stablecoinTypedUpgradeCapId = createdTypedUpgradeCap[0].objectId;
  });

  it("Deposits an UpgradeCap into an UpgradeCap<T> for the 'stablecoin' package correctly", async () => {
    const { objectChanges } = (await depositUpgradeCapCommand(
      RPC_URL,
      suiExtensionsPackageId,
      stablecoinUpgradeCapId,
      stablecoinTypedUpgradeCapId,
      stablecoinUpgradeCapOwner.getSecretKey()
    ))!;

    // Figure out the new owner of the UpgradeCap.
    let newStablecoinUpgradeCapOwner: string;
    {
      const stablecoinUpgradeCapChanges =
        objectChanges
          ?.filter((c): c is SuiObjectChangeMutated => c.type === "mutated")
          .filter((c) => c.objectId === stablecoinUpgradeCapId) || [];
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
      const newStablecoinUpgradeCapOwnerChanges =
        objectChanges
          ?.filter((c): c is SuiObjectChangeCreated => c.type === "created")
          .filter((c) => c.objectId === newStablecoinUpgradeCapOwner) || [];
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

    // Ensure that the owner of the dynamic field is the UpgradeCap<T> itself.
    assert.equal(dynamicFieldOwner, stablecoinTypedUpgradeCapId);
  });
});
