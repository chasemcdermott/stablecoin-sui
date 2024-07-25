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

import { CoinMetadata, SuiClient } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { strict as assert } from "assert";
import { deployCommand } from "../../scripts/deploy";
import { generateKeypairCommand } from "../../scripts/generateKeypair";
import { Ed25519Keypair } from "@mysten/sui/dist/cjs/keypairs/ed25519";
import { SuiTreasuryClient } from "../../scripts/helpers";

describe("Test PTBs", () => {
  const RPC_URL: string = process.env.RPC_URL as string;
  const client = new SuiClient({ url: RPC_URL });
  let treasuryClient: SuiTreasuryClient;

  let deployerKeys: Ed25519Keypair;
  let upgraderKeys: Ed25519Keypair;

  before("Deploy USDC", async () => {
    deployerKeys = await generateKeypairCommand(true);
    upgraderKeys = await generateKeypairCommand(false);

    const deployTxOutput = await deployCommand(
      "usdc",
      RPC_URL,
      deployerKeys.getSecretKey(),
      upgraderKeys.toSuiAddress(),
      true // with unpublished dependencies
    );

    treasuryClient = SuiTreasuryClient.buildFromDeployment(
      client,
      deployTxOutput
    );
  });

  it("Builds and submits a PTB successfully", async () => {
    const new_name = "new name";
    const new_symbol = "new symbol";
    const new_desc = "new description";
    const new_icon = "new icon url";

    await treasuryClient.updateMetadata(
      deployerKeys,
      new_name,
      new_symbol,
      new_desc,
      new_icon
    );

    // Assert that metadata object was updated
    const maybeMetadata = await client.getCoinMetadata({
      coinType: treasuryClient.coinOtwType
    });
    assert.notEqual(maybeMetadata, null);

    const metadata = maybeMetadata as CoinMetadata;
    assert.equal(metadata.decimals, 6);
    assert.equal(metadata.name, new_name);
    assert.equal(metadata.symbol, new_symbol);
    assert.equal(metadata.description, new_desc);
    assert.equal(metadata.iconUrl, new_icon);
  });

  it("Builds and submits a PTB to update roles via entry functions", async () => {
    const deployerAddress = deployerKeys.getPublicKey().toSuiAddress();
    const newAddress = (await generateKeypairCommand(false))
      .getPublicKey()
      .toSuiAddress();

    // Build a PTB to update some roles
    const txb = new Transaction();
    txb.moveCall({
      target: `${treasuryClient.stablecoinPackageId}::entry::update_blocklister`,
      typeArguments: [treasuryClient.coinOtwType],
      arguments: [
        txb.object(treasuryClient.treasuryObjectId),
        txb.pure.address(newAddress)
      ]
    });
    txb.moveCall({
      target: `${treasuryClient.stablecoinPackageId}::entry::update_pauser`,
      typeArguments: [treasuryClient.coinOtwType],
      arguments: [
        txb.object(treasuryClient.treasuryObjectId),
        txb.pure.address(newAddress)
      ]
    });

    // Sign and submit transaction, assert success
    const result = await client.signAndExecuteTransaction({
      signer: deployerKeys,
      transaction: txb,
      options: {
        showBalanceChanges: true,
        showEffects: true,
        showEvents: true,
        showInput: true,
        showObjectChanges: true,
        showRawInput: true
      }
    });
    assert.equal(result.effects?.status.status, "success");

    // Wait for the transaction to be available over API
    await client.waitForTransaction({
      digest: result.digest
    });

    // Assert that roles were updated
    const roles = await treasuryClient.getRoles();
    assert.equal(roles.owner, deployerAddress);
    assert.equal(roles.masterMinter, deployerAddress);
    assert.equal(roles.blocklister, newAddress);
    assert.equal(roles.pauser, newAddress);
    assert.equal(roles.metadataUpdater, deployerAddress);
  });
});
