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

import { CoinMetadata, SuiClient, SuiObjectChange } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { strict as assert } from "assert";
import { deploy } from "../../scripts/deploy";
import { generateKeypair } from "../../scripts/generateKeypair";
import {
  SuiObjectChangeCreated,
  SuiObjectChangePublished
} from "@mysten/sui/dist/cjs/client";
import { Ed25519Keypair } from "@mysten/sui/dist/cjs/keypairs/ed25519";

describe("Test PTBs", () => {
  const RPC_URL: string = process.env.RPC_URL as string;
  const client = new SuiClient({ url: RPC_URL });

  let deployerKeys: Ed25519Keypair;
  let upgraderKeys: Ed25519Keypair;

  let PACKAGE_ID: string;
  let TREASURY_OBJECT_ID: string;
  let METADATA_OBJECT_ID: string;
  let USDC_TYPE_ID: string;

  before("Deploy USDC", async () => {
    deployerKeys = await generateKeypair(true);
    upgraderKeys = await generateKeypair(false);

    const { objectChanges } = await deploy(
      "usdc",
      RPC_URL,
      deployerKeys.getSecretKey(),
      upgraderKeys.toSuiAddress(),
      true // with unpublished dependencies
    );

    const isPackage = (c: SuiObjectChange) => c.type === "published";
    const published = objectChanges?.filter(isPackage) || [];
    assert.equal(published.length, 1);
    PACKAGE_ID = (published[0] as SuiObjectChangePublished).packageId;
    USDC_TYPE_ID = `${PACKAGE_ID}::usdc::USDC`;

    const isTreasury = (c: SuiObjectChange) =>
      c.type === "created" && c.objectType.includes("treasury::Treasury");
    const treasury = objectChanges?.filter(isTreasury) || [];
    assert.equal(treasury.length, 1);
    TREASURY_OBJECT_ID = (treasury[0] as SuiObjectChangeCreated).objectId;

    const isMetadata = (c: SuiObjectChange) =>
      c.type === "created" && c.objectType.includes("coin::CoinMetadata");
    const metadata = objectChanges?.filter(isMetadata) || [];
    assert.equal(metadata.length, 1);
    METADATA_OBJECT_ID = (metadata[0] as SuiObjectChangeCreated).objectId;
  });

  it("Builds and submits a PTB successfully", async () => {
    const new_name = "new name";
    const new_symbol = "new symbol";
    const new_desc = "new description";
    const new_icon = "new icon url";

    // Build a PTB to update metadata
    const txb = new Transaction();
    txb.moveCall({
      target: `${PACKAGE_ID}::treasury::update_metadata`,
      typeArguments: [USDC_TYPE_ID],
      arguments: [
        txb.object(TREASURY_OBJECT_ID),
        txb.object(METADATA_OBJECT_ID),
        txb.pure.string(new_name),
        txb.pure.string(new_symbol),
        txb.pure.string(new_desc),
        txb.pure.string(new_icon)
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

    // Assert that metadata object was updated
    const maybeMetadata = await client.getCoinMetadata({
      coinType: USDC_TYPE_ID
    });
    assert.notEqual(maybeMetadata, null);

    const metadata = maybeMetadata as CoinMetadata;
    assert.equal(metadata.decimals, 6);
    assert.equal(metadata.name, new_name);
    assert.equal(metadata.symbol, new_symbol);
    assert.equal(metadata.description, new_desc);
    assert.equal(metadata.iconUrl, new_icon);
  });
});
