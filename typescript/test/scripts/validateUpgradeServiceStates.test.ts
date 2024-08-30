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
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  expectError,
  DEFAULT_GAS_BUDGET,
  getCreatedObjects,
  getPublishedPackages
} from "../../scripts/helpers";
import {
  UpgradeServiceStates,
  validateUpgradeServiceStates
} from "../../scripts/validateUpgradeServiceStates";
import SuiUpgradeServiceClient from "../../scripts/helpers/upgradeServiceClient";

describe("Test validate upgrade service states script", () => {
  const RPC_URL: string = process.env.RPC_URL as string;
  const client = new SuiClient({ url: RPC_URL });
  let upgradeServiceClient: SuiUpgradeServiceClient;

  let deployerKeys: Ed25519Keypair;
  let upgraderKeys: Ed25519Keypair;
  let expectedStates: UpgradeServiceStates;

  before("Deploy USDC and Stablecoin Package", async () => {
    deployerKeys = await generateKeypairCommand({ prefund: true });
    upgraderKeys = await generateKeypairCommand({ prefund: true });

    const deployTxOutput = await deployCommand("usdc", {
      rpcUrl: RPC_URL,
      deployerKey: deployerKeys.getSecretKey(),
      upgradeCapRecipient: upgraderKeys.toSuiAddress(),
      withUnpublishedDependencies: true,
      gasBudget: DEFAULT_GAS_BUDGET.toString()
    });

    const usdcPackageId = getPublishedPackages(deployTxOutput)[0].packageId;

    const upgradeServiceObjectId = getCreatedObjects(deployTxOutput, {
      objectType: /upgrade_service::UpgradeService<\w{66}::\w*::\w*>/
    })[0].objectId;

    const upgradeCapObjectId = getCreatedObjects(deployTxOutput, {
      objectType: /package::UpgradeCap/
    })[0].objectId;

    upgradeServiceClient = await SuiUpgradeServiceClient.buildFromId(
      client,
      upgradeServiceObjectId
    );

    expectedStates = {
      suiExtensionsPackageId: upgradeServiceClient.suiExtensionsPackageId,
      upgradeServiceOtwType: upgradeServiceClient.upgradeServiceOtwType,
      admin: deployerKeys.toSuiAddress(),
      pendingAdmin: "",
      upgradeCapPackageId: usdcPackageId,
      upgradeCapVersion: "1",
      upgradeCapPolicy: 0
    };

    // Expect missing values because upgrade cap has not been deposited yet.
    await expectError(
      () => validateUpgradeServiceStates(upgradeServiceClient, expectedStates),
      /Missing return values!/
    );

    // deposit upgrade cap
    await upgradeServiceClient.depositUpgradeCap(
      upgraderKeys,
      upgradeCapObjectId,
      {
        gasBudget: DEFAULT_GAS_BUDGET
      }
    );

    await validateUpgradeServiceStates(upgradeServiceClient, expectedStates);
  });

  it("Successfully validates all upgrade service states when pending admin is set", async () => {
    await upgradeServiceClient.changeAdmin(
      deployerKeys,
      upgraderKeys.toSuiAddress(),
      {
        gasBudget: DEFAULT_GAS_BUDGET
      }
    );
    expectedStates.pendingAdmin = upgraderKeys.toSuiAddress();
    await validateUpgradeServiceStates(upgradeServiceClient, expectedStates);
  });

  it("Fails to validate when package ID or type is incorrect", async () => {
    const randomAddress = Ed25519Keypair.generate().toSuiAddress();

    const invalidPackageIdStates = { ...expectedStates };
    invalidPackageIdStates.suiExtensionsPackageId = randomAddress;
    await expectError(
      () =>
        validateUpgradeServiceStates(
          upgradeServiceClient,
          invalidPackageIdStates
        ),
      /Expected values to be strictly deep-equal/
    );

    const invalidOtwTypeStates = { ...expectedStates };
    invalidOtwTypeStates.upgradeServiceOtwType = `${randomAddress}::usdc::USDC`;
    await expectError(
      () =>
        validateUpgradeServiceStates(
          upgradeServiceClient,
          invalidOtwTypeStates
        ),
      /Expected values to be strictly deep-equal/
    );
  });

  it("Fails to validate when the admin or pending admin are incorrect", async () => {
    const randomAddress = Ed25519Keypair.generate().toSuiAddress();

    const invalidAdminStates = { ...expectedStates };
    invalidAdminStates.admin = randomAddress;
    await expectError(
      () =>
        validateUpgradeServiceStates(upgradeServiceClient, invalidAdminStates),
      /Expected values to be strictly deep-equal/
    );

    const invalidPendingAdminStates = { ...expectedStates };
    invalidPendingAdminStates.pendingAdmin = randomAddress;
    await expectError(
      () =>
        validateUpgradeServiceStates(
          upgradeServiceClient,
          invalidPendingAdminStates
        ),
      /Expected values to be strictly deep-equal/
    );
  });

  it("Fails to validate when the upgrade cap data is incorrect", async () => {
    const randomAddress = Ed25519Keypair.generate().toSuiAddress();

    const invalidUpgradePackageStates = { ...expectedStates };
    invalidUpgradePackageStates.upgradeCapPackageId = randomAddress;
    await expectError(
      () =>
        validateUpgradeServiceStates(
          upgradeServiceClient,
          invalidUpgradePackageStates
        ),
      /Expected values to be strictly deep-equal/
    );

    const invalidVersionStates = { ...expectedStates };
    invalidVersionStates.upgradeCapVersion = "2";
    await expectError(
      () =>
        validateUpgradeServiceStates(
          upgradeServiceClient,
          invalidVersionStates
        ),
      /Expected values to be strictly deep-equal/
    );

    const invalidPolicyStates = { ...expectedStates };
    invalidPolicyStates.upgradeCapPolicy = 3;
    await expectError(
      () =>
        validateUpgradeServiceStates(upgradeServiceClient, invalidPolicyStates),
      /Expected values to be strictly deep-equal/
    );
  });
});
