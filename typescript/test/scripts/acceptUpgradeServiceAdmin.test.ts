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
import { deployCommand } from "../../scripts/deploy";
import { generateKeypairCommand } from "../../scripts/generateKeypair";
import { Ed25519Keypair } from "@mysten/sui/dist/cjs/keypairs/ed25519";
import { acceptUpgradeServiceAdminHelper } from "../../scripts/acceptUpgradeServiceAdmin";
import {
  expectError,
  getCreatedObjects,
  DEFAULT_GAS_BUDGET
} from "../../scripts/helpers";
import { strict as assert } from "assert";
import UpgradeServiceClient from "../../scripts/helpers/upgradeServiceClient";
import { testChangeUpgradeServiceAdmin } from "./changeUpgradeServiceAdmin.test";

describe("Test accept upgrade service admin script", () => {
  const RPC_URL: string = process.env.RPC_URL as string;

  let deployerKeys: Ed25519Keypair;
  let upgraderKeys: Ed25519Keypair;
  let newUsdcUpgradeServiceAdmin: Ed25519Keypair;
  let newStablecoinUpgradeServiceAdmin: Ed25519Keypair;
  let upgradeServiceStablecoinObjectId: string;
  let upgradeServiceUsdcObjectId: string;

  before("Deploy USDC and Stablecoin Package", async () => {
    deployerKeys = await generateKeypairCommand({ prefund: true });
    upgraderKeys = await generateKeypairCommand({ prefund: false });

    const usdcDeployTxOutput = await deployCommand("usdc", {
      rpcUrl: RPC_URL,
      deployerKey: deployerKeys.getSecretKey(),
      upgradeCapRecipient: upgraderKeys.toSuiAddress(),
      withUnpublishedDependencies: true,
      gasBudget: DEFAULT_GAS_BUDGET.toString()
    });

    // Get object id for stablecoin deployment
    const upgradeServiceStablecoinObjects = getCreatedObjects(
      usdcDeployTxOutput,
      {
        objectType:
          /\w{66}::upgrade_service::UpgradeService<\w{66}::stablecoin::STABLECOIN>/
      }
    );
    if (upgradeServiceStablecoinObjects.length !== 1) {
      throw new Error(
        "Expected to have one upgrade service object in the tx output"
      );
    }
    upgradeServiceStablecoinObjectId =
      upgradeServiceStablecoinObjects[0].objectId;

    // Get object id for usdc deployment
    const upgradeServiceUsdcObjects = getCreatedObjects(usdcDeployTxOutput, {
      objectType: /\w{66}::upgrade_service::UpgradeService<\w{66}::usdc::USDC>/
    });
    if (upgradeServiceUsdcObjects.length == 0) {
      throw new Error(
        "Expected to have at least one upgrade service object in the tx output"
      );
    }
    upgradeServiceUsdcObjectId = upgradeServiceUsdcObjects[0].objectId;

    // Generate shared keys for testing
    newUsdcUpgradeServiceAdmin = await generateKeypairCommand({
      prefund: true
    });
    newStablecoinUpgradeServiceAdmin = await generateKeypairCommand({
      prefund: true
    });

    // USDC package: initiate admin role transfer to new USDC upgrade service admin
    await testChangeUpgradeServiceAdmin({
      upgradeServiceAdmin: deployerKeys,
      upgradeServiceObjectId: upgradeServiceUsdcObjectId,
      newUpgradeServiceAdmin: newUsdcUpgradeServiceAdmin,
      rpcUrl: RPC_URL
    });

    // Stablecoin package: initiate admin role transfer to new Stablecoin upgrade service admin
    await testChangeUpgradeServiceAdmin({
      upgradeServiceAdmin: deployerKeys,
      upgradeServiceObjectId: upgradeServiceStablecoinObjectId,
      newUpgradeServiceAdmin: newStablecoinUpgradeServiceAdmin,
      rpcUrl: RPC_URL
    });
  });

  it("Fails when the signing owner is inconsistent with actual pending owner", async () => {
    const randomKeys = await generateKeypairCommand({ prefund: false });

    // Test USDC package
    await expectError(
      () =>
        testAcceptUpgradeServiceAdmin({
          pendingUpgradeServiceAdmin: randomKeys,
          upgradeServiceObjectId: upgradeServiceUsdcObjectId,
          rpcUrl: RPC_URL
        }),
      /Incorrect private key supplied.*/
    );

    // Test stablecoin package
    await expectError(
      () =>
        testAcceptUpgradeServiceAdmin({
          pendingUpgradeServiceAdmin: randomKeys,
          upgradeServiceObjectId: upgradeServiceStablecoinObjectId,
          rpcUrl: RPC_URL
        }),
      /Incorrect private key supplied.*/
    );
  });

  it("Successfully updates upgrade service admin to given addresses", async () => {
    // Test USDC package
    await testAcceptUpgradeServiceAdmin({
      pendingUpgradeServiceAdmin: newUsdcUpgradeServiceAdmin,
      upgradeServiceObjectId: upgradeServiceUsdcObjectId,
      rpcUrl: RPC_URL
    });

    // Test stablecoin package
    await testAcceptUpgradeServiceAdmin({
      pendingUpgradeServiceAdmin: newStablecoinUpgradeServiceAdmin,
      upgradeServiceObjectId: upgradeServiceStablecoinObjectId,
      rpcUrl: RPC_URL
    });
  });
});

async function testAcceptUpgradeServiceAdmin(args: {
  pendingUpgradeServiceAdmin: Ed25519Keypair;
  upgradeServiceObjectId: string;
  rpcUrl: string;
}) {
  const suiClient = new SuiClient({ url: args.rpcUrl });
  const upgradeServiceClient = await UpgradeServiceClient.buildFromId(
    suiClient,
    args.upgradeServiceObjectId
  );

  await acceptUpgradeServiceAdminHelper(upgradeServiceClient, {
    pendingUpgradeServiceAdminKey:
      args.pendingUpgradeServiceAdmin.getSecretKey(),
    gasBudget: DEFAULT_GAS_BUDGET.toString()
  });

  // Pending admin should now be null
  const pendingAdmin = await upgradeServiceClient.getPendingAdmin();
  assert.equal(pendingAdmin, null);

  // The provided pending admin should now be the admin
  const admin = await upgradeServiceClient.getAdmin();
  assert.equal(admin, args.pendingUpgradeServiceAdmin.toSuiAddress());
}
