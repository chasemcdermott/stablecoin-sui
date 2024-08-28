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
import { deployCommand } from "../../scripts/deploy";
import { generateKeypairCommand } from "../../scripts/generateKeypair";
import { DEFAULT_GAS_BUDGET, SuiTreasuryClient } from "../../scripts/helpers";
import { setBlocklistStateHelper } from "../../scripts/setBlocklistState";

describe("Test set blocklist state script", () => {
  const RPC_URL: string = process.env.RPC_URL as string;
  const client = new SuiClient({ url: RPC_URL });
  let treasuryClient: SuiTreasuryClient;

  let deployerKeys: Ed25519Keypair;

  before("Deploy USDC", async () => {
    deployerKeys = await generateKeypairCommand({ prefund: true });

    const upgraderKeys = await generateKeypairCommand({ prefund: false });
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
  });

  it("Successfully updates blocklist state for an address", async () => {
    const randomAddress = (
      await generateKeypairCommand({ prefund: false })
    ).toSuiAddress();
    await setBlocklistStateHelper(treasuryClient, randomAddress, {
      blocklisterKey: deployerKeys.getSecretKey(),
      unblock: false,
      gasBudget: DEFAULT_GAS_BUDGET.toString()
    });
    assert.equal(
      await treasuryClient.isBlocklisted(randomAddress, "next"),
      true
    );

    await setBlocklistStateHelper(treasuryClient, randomAddress, {
      blocklisterKey: deployerKeys.getSecretKey(),
      unblock: true,
      gasBudget: DEFAULT_GAS_BUDGET.toString()
    });
    assert.equal(
      await treasuryClient.isBlocklisted(randomAddress, "next"),
      false
    );
  });
});
