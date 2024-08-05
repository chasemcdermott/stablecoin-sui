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

describe("Test rotatate privileged roles script", () => {
  const RPC_URL: string = process.env.RPC_URL as string;
  const client = new SuiClient({ url: RPC_URL });
  let treasuryClient: SuiTreasuryClient;

  let deployerKeys: Ed25519Keypair;
  let upgraderKeys: Ed25519Keypair;
  let newMasterMinterKey: Ed25519Keypair;
  let newBlocklisterKey: Ed25519Keypair;
  let newPauserKey: Ed25519Keypair;
  let newMetadataUpdaterKey: Ed25519Keypair;
  let newTreasuryOwnerKey: Ed25519Keypair;

  before("Deploy USDC", async () => {
    deployerKeys = await generateKeypairCommand({ prefund: true });
    upgraderKeys = await generateKeypairCommand({ prefund: false });
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

    // generate shared keys for testing
    newMasterMinterKey = await generateKeypairCommand({ prefund: false });
    newBlocklisterKey = await generateKeypairCommand({ prefund: false });
    newPauserKey = await generateKeypairCommand({ prefund: false });
    newMetadataUpdaterKey = await generateKeypairCommand({
      prefund: false
    });
    newTreasuryOwnerKey = await generateKeypairCommand({
      prefund: false
    });
  });

  it("Fails when the owner is inconsistent with actual owner", async () => {
    const randomKeys = await generateKeypairCommand({ prefund: false });
    await expectError(
      () =>
        testRotatePrivilegedRoles({
          treasuryClient,
          treasuryOwner: randomKeys,
          newMasterMinter: newMasterMinterKey,
          newBlocklister: newBlocklisterKey,
          newPauser: newPauserKey,
          newMetadataUpdater: newMetadataUpdaterKey,
          newTreasuryOwner: newTreasuryOwnerKey
        }),
      /Incorrect treasury owner key.*/
    );
  });

  it("Successfully updates all priviledged roles to given addresses", async () => {
    await testRotatePrivilegedRoles({
      treasuryClient,
      treasuryOwner: deployerKeys,
      newMasterMinter: newMasterMinterKey,
      newBlocklister: newBlocklisterKey,
      newPauser: newPauserKey,
      newMetadataUpdater: newMetadataUpdaterKey,
      newTreasuryOwner: newTreasuryOwnerKey
    });
  });
});

async function testRotatePrivilegedRoles(args: {
  treasuryClient: SuiTreasuryClient;
  treasuryOwner: Ed25519Keypair;
  newMasterMinter: Ed25519Keypair;
  newBlocklister: Ed25519Keypair;
  newPauser: Ed25519Keypair;
  newMetadataUpdater: Ed25519Keypair;
  newTreasuryOwner: Ed25519Keypair;
}) {
  await rotatePrivilegedRolesHelper(args.treasuryClient, {
    treasuryOwnerKey: args.treasuryOwner.getSecretKey(),
    newMasterMinter: args.newMasterMinter.toSuiAddress(),
    newBlocklister: args.newBlocklister.toSuiAddress(),
    newPauser: args.newPauser.toSuiAddress(),
    newMetadataUpdater: args.newMetadataUpdater.toSuiAddress(),
    newTreasuryOwner: args.newTreasuryOwner.toSuiAddress(),
    gasBudget: DEFAULT_GAS_BUDGET.toString()
  });

  const { masterMinter, blocklister, pauser, metadataUpdater, pendingOwner } =
    await args.treasuryClient.getRoles();
  assert.equal(masterMinter, args.newMasterMinter.toSuiAddress());
  assert.equal(blocklister, args.newBlocklister.toSuiAddress());
  assert.equal(pauser, args.newPauser.toSuiAddress());
  assert.equal(metadataUpdater, args.newMetadataUpdater.toSuiAddress());
  assert.equal(pendingOwner, args.newTreasuryOwner.toSuiAddress());
}
