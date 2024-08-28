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
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { strict as assert } from "assert";
import { deployCommand } from "../scripts/deploy";
import { generateKeypairCommand } from "../scripts/generateKeypair";
import {
  DEFAULT_GAS_BUDGET,
  expectError,
  getPublishedPackages
} from "../scripts/helpers";

describe("Test total supply query", () => {
  const RPC_URL: string = process.env.RPC_URL as string;
  const client = new SuiClient({ url: RPC_URL });

  let deployerKeys: Ed25519Keypair;
  let upgraderKeys: Ed25519Keypair;

  let PACKAGE_ID: string;
  let USDC_TYPE_ID: string;

  before("Deploy USDC", async () => {
    deployerKeys = await generateKeypairCommand({ prefund: true });
    upgraderKeys = await generateKeypairCommand({ prefund: false });

    const deployTx = await deployCommand("usdc", {
      rpcUrl: RPC_URL,
      deployerKey: deployerKeys.getSecretKey(),
      upgradeCapRecipient: upgraderKeys.toSuiAddress(),
      withUnpublishedDependencies: true,
      gasBudget: DEFAULT_GAS_BUDGET.toString()
    });

    const published = getPublishedPackages(deployTx);
    assert.equal(published.length, 1);
    PACKAGE_ID = published[0].packageId;
    USDC_TYPE_ID = `${PACKAGE_ID}::usdc::USDC`;
  });

  it("Throws when querying total supply on non-existent coin type", async () => {
    await expectError(
      () =>
        client.getTotalSupply({ coinType: "0x0::nonexistent::NONEXISTENT" }),
      "ObjectNotFound"
    );
  });

  it("Returns total supply correctly upon querying", async () => {
    const totalSupply = await client.getTotalSupply({ coinType: USDC_TYPE_ID });
    assert.equal(parseFloat(totalSupply.value), 0);
  });
});
