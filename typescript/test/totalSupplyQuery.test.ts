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
import { deploy } from "../scripts/deploy";
import { generateKeypair } from "../scripts/generateKeypair";
import { SuiObjectChangePublished } from "@mysten/sui/dist/cjs/client";
import { Ed25519Keypair } from "@mysten/sui/dist/cjs/keypairs/ed25519";

describe("Test total supply query", () => {
  const RPC_URL: string = process.env.RPC_URL as string;
  const client = new SuiClient({ url: RPC_URL });

  let deployerKeys: Ed25519Keypair;
  let upgraderKeys: Ed25519Keypair;

  let PACKAGE_ID: string;
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

    const published =
      objectChanges?.filter((c) => c.type === "published") || [];
    assert.equal(published.length, 1);
    PACKAGE_ID = (published[0] as SuiObjectChangePublished).packageId;
    USDC_TYPE_ID = `${PACKAGE_ID}::usdc::USDC`;
  });

  it("Throws when querying total supply on non-existent coin type", async () => {
    await assert.rejects(
      () =>
        client.getTotalSupply({ coinType: "0x0::nonexistent::NONEXISTENT" }),
      (err: any) => {
        assert(err.message.includes("ObjectNotFound"));
        return true;
      }
    );
  });

  it("Returns total supply correctly upon querying", async () => {
    const totalSupply = await client.getTotalSupply({ coinType: USDC_TYPE_ID });
    assert.equal(parseFloat(totalSupply.value), 0);
  });
});
