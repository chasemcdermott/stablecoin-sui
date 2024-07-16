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
import { generateKeypairCommand } from "../../scripts/generateKeypair";
import { Ed25519Keypair } from "@mysten/sui/dist/cjs/keypairs/ed25519";

describe("Test generate keypair script", async () => {
  let suiClient: SuiClient;

  before(() => {
    suiClient = new SuiClient({
      url: process.env.RPC_URL as string
    });
  });

  it("Returns new keypair", async () => {
    const keys: Ed25519Keypair = await generateKeypairCommand(false);

    assert.equal(keys.getSecretKey().length, 70);
    assert.equal(keys.getPublicKey().toSuiAddress().length, 66);
    const suiBalance = await suiClient.getBalance({
      owner: keys.getPublicKey().toSuiAddress()
    });
    assert.equal(suiBalance.coinType, "0x2::sui::SUI");
    assert.equal(suiBalance.totalBalance, "0");
  });

  it("Returns prefunded keypair", async () => {
    const keys: Ed25519Keypair = await generateKeypairCommand(true);

    assert.equal(keys.getSecretKey().length, 70);
    assert.equal(keys.getPublicKey().toSuiAddress().length, 66);
    const suiBalance = await suiClient.getBalance({
      owner: keys.getPublicKey().toSuiAddress()
    });
    assert.equal(suiBalance.coinType, "0x2::sui::SUI");
    assert.equal(suiBalance.totalBalance, "1000000000000");
  });
});
