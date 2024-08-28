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
import { strict as assert } from "assert";
import { deployCommand } from "../../scripts/deploy";
import { generateKeypairCommand } from "../../scripts/generateKeypair";
import { Ed25519Keypair } from "@mysten/sui/dist/cjs/keypairs/ed25519";
import { testConfigureMinter } from "./configureMinter.test";
import {
  DEFAULT_GAS_BUDGET,
  expectError,
  SuiTreasuryClient
} from "../../scripts/helpers";
import { rotateControllerHelper } from "../../scripts/rotateController";

describe("Test configure minter script", () => {
  const RPC_URL: string = process.env.RPC_URL as string;
  const client = new SuiClient({ url: RPC_URL });
  let treasuryClient: SuiTreasuryClient;

  let deployerKeys: Ed25519Keypair;
  let upgraderKeys: Ed25519Keypair;
  let currentControllerKeys: Ed25519Keypair;

  before("Deploy USDC and configure a minter", async () => {
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

    const finalControllerKeys = await generateKeypairCommand({ prefund: true });
    const minterKeys = await generateKeypairCommand({ prefund: false });
    await testConfigureMinter({
      treasuryClient,
      masterMinter: deployerKeys,
      tempController: deployerKeys,
      minter: minterKeys,
      mintAllowanceInDollars: BigInt(18446744073709),
      finalController: finalControllerKeys
    });
    currentControllerKeys = finalControllerKeys;
  });

  it("Fails to rotate controller if the master minter is incorrect", async () => {
    const randomKeys = await generateKeypairCommand({ prefund: false });
    await expectError(
      () =>
        testRotateController({
          treasuryClient,
          masterMinter: randomKeys,
          oldController: currentControllerKeys,
          newController: randomKeys
        }),
      "Incorrect master minter key"
    );
  });

  it("Successfully rotates the controller keys twice", async () => {
    const newController = await generateKeypairCommand({ prefund: false });
    await testRotateController({
      treasuryClient,
      masterMinter: deployerKeys,
      oldController: currentControllerKeys,
      newController: newController
    });
    await testRotateController({
      treasuryClient,
      masterMinter: deployerKeys,
      oldController: newController,
      newController: currentControllerKeys
    });
  });
});

async function testRotateController(args: {
  treasuryClient: SuiTreasuryClient;
  masterMinter: Ed25519Keypair;
  oldController: Ed25519Keypair;
  newController: Ed25519Keypair;
}) {
  const originalMintCapId = await args.treasuryClient.getMintCapId(
    args.oldController.toSuiAddress()
  );

  await rotateControllerHelper(args.treasuryClient, {
    hotMasterMinterKey: args.masterMinter.getSecretKey(),
    oldControllerAddress: args.oldController.toSuiAddress(),
    newControllerAddress: args.newController.toSuiAddress(),
    gasBudget: DEFAULT_GAS_BUDGET.toString()
  });

  // assert that final controller address is controller of the MintCap
  const newControllerMintCapId = await args.treasuryClient.getMintCapId(
    args.newController.toSuiAddress()
  );
  assert.equal(newControllerMintCapId, originalMintCapId);

  // assert that the old controller is no longer a controller
  const tempControllerMintCapId = await args.treasuryClient.getMintCapId(
    args.oldController.toSuiAddress()
  );
  assert.equal(tempControllerMintCapId, null);
}
