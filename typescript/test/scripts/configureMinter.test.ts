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
import { SuiTreasuryClient } from "../../scripts/helpers";
import { random } from "lodash";

describe("Test configure minter script", () => {
  const RPC_URL: string = process.env.RPC_URL as string;
  const client = new SuiClient({ url: RPC_URL });
  let treasuryClient: SuiTreasuryClient;

  let deployerKeys: Ed25519Keypair;
  let upgraderKeys: Ed25519Keypair;
  let currentControllerKeys: Ed25519Keypair;
  let currentMinter: Ed25519Keypair;

  before("Deploy USDC and configure a minter", async () => {
    deployerKeys = await generateKeypairCommand(true);
    upgraderKeys = await generateKeypairCommand(false);

    const deployTxOutput = await deployCommand(
      "usdc",
      RPC_URL,
      deployerKeys.getSecretKey(),
      upgraderKeys.toSuiAddress(),
      true // with unpublished dependencies
    );

    // build a client from the usdc deploy transaction output
    treasuryClient = SuiTreasuryClient.buildFromDeployment(
      client,
      deployTxOutput
    );

    const coldControllerKeys = await generateKeypairCommand(true);
    const minterKeys = await generateKeypairCommand(false);
    const initialAllowance = 12345;
    await testConfigureMinter({
      treasuryClient,
      masterMinter: deployerKeys,
      hotController: deployerKeys,
      minter: minterKeys,
      mintAllowance: initialAllowance,
      coldController: coldControllerKeys
    });
    currentControllerKeys = coldControllerKeys;
    currentMinter = minterKeys;
  });

  it("Fails when the cold controller already exists", async () => {
    const randomKeys = await generateKeypairCommand(false);
    await assert.rejects(
      () =>
        testConfigureMinter({
          treasuryClient,
          masterMinter: deployerKeys,
          hotController: randomKeys,
          minter: currentMinter,
          mintAllowance: 12345,
          coldController: currentControllerKeys
        }),
      (err: any) => {
        assert(err.message.includes("Cold controller is already configured"));
        return true;
      }
    );
  });

  it("Fails when the master minter key is incorrect", async () => {
    const randomKeys = await generateKeypairCommand(false);
    await assert.rejects(
      () =>
        testConfigureMinter({
          treasuryClient,
          masterMinter: randomKeys,
          hotController: randomKeys,
          minter: currentMinter,
          mintAllowance: 12345,
          coldController: randomKeys
        }),
      (err: any) => {
        assert(err.message.includes("Incorrect master minter key"));
        return true;
      }
    );
  });

  it("Fails when the hot controller exists and the minter is different", async () => {
    const randomKeys = await generateKeypairCommand(false);
    await assert.rejects(
      () =>
        testConfigureMinter({
          treasuryClient,
          masterMinter: deployerKeys,
          hotController: currentControllerKeys,
          minter: randomKeys,
          mintAllowance: 12345,
          coldController: randomKeys
        }),
      (err: any) => {
        assert(
          err.message.match(
            /Hot controller was already configured, but the MintCap \w* is held by \w*/
          )
        );
        return true;
      }
    );
  });

  it("Successfully updates the allowance and rotates the keys when the hot controller already exists", async () => {
    const newColdController = await generateKeypairCommand(false);
    await testConfigureMinter({
      treasuryClient,
      masterMinter: deployerKeys,
      hotController: currentControllerKeys,
      minter: currentMinter,
      mintAllowance: random(100_000_000, 200_000_000),
      coldController: newColdController
    });
  });
});

async function testConfigureMinter(args: {
  treasuryClient: SuiTreasuryClient;
  masterMinter: Ed25519Keypair;
  hotController: Ed25519Keypair;
  minter: Ed25519Keypair;
  mintAllowance: number;
  coldController: Ed25519Keypair;
}) {
  let mintCapId = await configureMinterHelper(
    args.treasuryClient,
    args.masterMinter.getSecretKey(),
    args.hotController.getSecretKey(),
    args.minter.toSuiAddress(),
    args.mintAllowance,
    args.coldController.toSuiAddress()
  );
  assert.notEqual(mintCapId, undefined);
  mintCapId = mintCapId as string;

  // assert that cold address is controller of the MintCap
  const controllerMintCapId = await args.treasuryClient.getMintCapId(
    args.coldController.toSuiAddress()
  );
  assert.equal(controllerMintCapId, mintCapId);

  // assert that the minter is holding the MintCap
  const mintCapHolder = await args.treasuryClient.getMintCapOwner(mintCapId);
  assert.equal(mintCapHolder, args.minter.toSuiAddress());

  // assert that the mint allowance was correctly configured
  const allowance = await args.treasuryClient.getMintAllowance(mintCapId);
  assert.equal(allowance, args.mintAllowance);

  // assert that the hot controller is no longer a controller
  const hotControllerMintCapId = await args.treasuryClient.getMintCapId(
    args.hotController.toSuiAddress()
  );
  assert.equal(hotControllerMintCapId, undefined);
}
