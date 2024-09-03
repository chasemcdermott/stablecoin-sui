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
import { rotatePrivilegedRolesHelper } from "../../scripts/rotatePrivilegedRoles";
import {
  expectError,
  SuiTreasuryClient,
  DEFAULT_GAS_BUDGET
} from "../../scripts/helpers";
import { strict as assert } from "assert";
import { acceptTreasuryOwnerHelper } from "../../scripts/acceptTreasuryOwner";

describe("Test accept pending treasury owner", () => {
  const RPC_URL: string = process.env.RPC_URL as string;
  const client = new SuiClient({ url: RPC_URL });
  let treasuryClient: SuiTreasuryClient;

  let deployerKeys: Ed25519Keypair;
  let upgraderKeys: Ed25519Keypair;
  let newTreasuryOwnerKeys: Ed25519Keypair;

  before("Deploy USDC", async () => {
    deployerKeys = await generateKeypairCommand({ prefund: true });
    upgraderKeys = await generateKeypairCommand({ prefund: false });
    newTreasuryOwnerKeys = await generateKeypairCommand({ prefund: true });

    const deployTxOutput = await deployCommand("usdc", {
      rpcUrl: RPC_URL,
      deployerKey: deployerKeys.getSecretKey(),
      upgradeCapRecipient: upgraderKeys.toSuiAddress(),
      withUnpublishedDependencies: true,
      gasBudget: DEFAULT_GAS_BUDGET.toString()
    });

    // build a client from the usdc deploy transaction output
    treasuryClient = SuiTreasuryClient.buildFromDeployment(
      client,
      deployTxOutput
    );

    await rotatePrivilegedRolesHelper(treasuryClient, {
      treasuryOwnerKey: deployerKeys.getSecretKey(),
      newMasterMinter: deployerKeys.toSuiAddress(),
      newBlocklister: deployerKeys.toSuiAddress(),
      newPauser: deployerKeys.toSuiAddress(),
      newMetadataUpdater: deployerKeys.toSuiAddress(),
      newTreasuryOwner: newTreasuryOwnerKeys.toSuiAddress(),
      gasBudget: DEFAULT_GAS_BUDGET.toString()
    });
  });

  it("Fails when the transaction signer is not the pending owner", async () => {
    const randomKeys = await generateKeypairCommand({ prefund: false });
    await expectError(
      () =>
        testRotatePrivilegedRoles({
          treasuryClient,
          newTreasuryOwner: randomKeys
        }),
      /Incorrect pending treasury owner key.*/
    );
  });

  it("Successfully transfers the owner role to the pending owner", async () => {
    await testRotatePrivilegedRoles({
      treasuryClient,
      newTreasuryOwner: newTreasuryOwnerKeys
    });
  });
});

async function testRotatePrivilegedRoles(args: {
  treasuryClient: SuiTreasuryClient;
  newTreasuryOwner: Ed25519Keypair;
}) {
  await acceptTreasuryOwnerHelper(args.treasuryClient, {
    pendingOwnerKey: args.newTreasuryOwner.getSecretKey(),
    gasBudget: DEFAULT_GAS_BUDGET.toString()
  });

  const { owner, pendingOwner } = await args.treasuryClient.getRoles();
  assert.equal(owner, args.newTreasuryOwner.toSuiAddress());
  assert.equal(pendingOwner, null);
}
