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
import { strict as assert } from "assert";
import { deployCommand } from "../../scripts/deploy";
import { generateKeypairCommand } from "../../scripts/generateKeypair";
import { Ed25519Keypair } from "@mysten/sui/dist/cjs/keypairs/ed25519";
import { configureMinterHelper } from "../../scripts/configureMinter";
import { expectError, SuiTreasuryClient } from "../../scripts/helpers";
import { random } from "lodash";

const USDC_DECIMALS = 6;

describe("Test configure minter script", () => {
  const RPC_URL: string = process.env.RPC_URL as string;
  const client = new SuiClient({ url: RPC_URL });
  let treasuryClient: SuiTreasuryClient;

  let deployerKeys: Ed25519Keypair;
  let upgraderKeys: Ed25519Keypair;
  let currentControllerKeys: Ed25519Keypair;
  let currentMinter: Ed25519Keypair;

  before("Deploy USDC and configure a minter", async () => {
    deployerKeys = await generateKeypairCommand({ prefund: true });
    upgraderKeys = await generateKeypairCommand({ prefund: false });

    const deployTxOutput = await deployCommand("usdc", {
      rpcUrl: RPC_URL,
      deployerKey: deployerKeys.getSecretKey(),
      upgradeCapRecipient: upgraderKeys.toSuiAddress(),
      withUnpublishedDependencies: true
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
    currentMinter = minterKeys;
  });

  it("Fails when the final controller already exists", async () => {
    const randomKeys = await generateKeypairCommand({ prefund: false });
    await expectError(
      () =>
        testConfigureMinter({
          treasuryClient,
          masterMinter: deployerKeys,
          tempController: randomKeys,
          minter: currentMinter,
          mintAllowanceInDollars: BigInt(18446744073709),
          finalController: currentControllerKeys
        }),
      "Final controller is already configured"
    );
  });

  it("Fails when the master minter key is incorrect", async () => {
    const randomKeys = await generateKeypairCommand({ prefund: false });
    await expectError(
      () =>
        testConfigureMinter({
          treasuryClient,
          masterMinter: randomKeys,
          tempController: randomKeys,
          minter: currentMinter,
          mintAllowanceInDollars: BigInt(18446744073709),
          finalController: randomKeys
        }),
      "Incorrect master minter key"
    );
  });

  it("Fails when the temp controller exists and the minter is different", async () => {
    const randomKeys = await generateKeypairCommand({ prefund: false });
    await expectError(
      () =>
        testConfigureMinter({
          treasuryClient,
          masterMinter: deployerKeys,
          tempController: currentControllerKeys,
          minter: randomKeys,
          mintAllowanceInDollars: BigInt(18446744073709),
          finalController: randomKeys
        }),
      /Temp controller was already configured, but the MintCap \w* is held by \w*/
    );
  });

  it("Successfully updates the allowance and rotates the keys when the temp controller already exists", async () => {
    const newFinalController = await generateKeypairCommand({ prefund: false });
    await testConfigureMinter({
      treasuryClient,
      masterMinter: deployerKeys,
      tempController: currentControllerKeys,
      minter: currentMinter,
      mintAllowanceInDollars: BigInt(random(100_000_000, 200_000_000)),
      finalController: newFinalController
    });
  });
});

async function testConfigureMinter(args: {
  treasuryClient: SuiTreasuryClient;
  masterMinter: Ed25519Keypair;
  tempController: Ed25519Keypair;
  minter: Ed25519Keypair;
  mintAllowanceInDollars: bigint;
  finalController: Ed25519Keypair;
}) {
  let mintCapId = await configureMinterHelper(args.treasuryClient, {
    hotMasterMinterKey: args.masterMinter.getSecretKey(),
    tempControllerKey: args.tempController.getSecretKey(),
    minterAddress: args.minter.toSuiAddress(),
    mintAllowanceInDollars: args.mintAllowanceInDollars,
    finalControllerAddress: args.finalController.toSuiAddress()
  });
  assert.notEqual(mintCapId, undefined);
  mintCapId = mintCapId as string;

  // assert that final controller address is controller of the MintCap
  const controllerMintCapId = await args.treasuryClient.getMintCapId(
    args.finalController.toSuiAddress()
  );
  assert.equal(controllerMintCapId, mintCapId);

  // assert that the minter is holding the MintCap
  const mintCapOwner = await args.treasuryClient.getObjectOwner(mintCapId);
  assert.equal(mintCapOwner.address, args.minter.toSuiAddress());

  // assert that the mint allowance was correctly configured
  const expectedAllowance =
    BigInt(args.mintAllowanceInDollars) * BigInt(10 ** USDC_DECIMALS);
  const allowance = await args.treasuryClient.getMintAllowance(mintCapId);
  assert.equal(allowance, expectedAllowance);

  // assert that the temp controller is no longer a controller
  const tempControllerMintCapId = await args.treasuryClient.getMintCapId(
    args.tempController.toSuiAddress()
  );
  assert.equal(tempControllerMintCapId, null);
}
