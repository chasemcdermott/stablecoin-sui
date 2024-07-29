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

import { strict as assert } from "assert";
import { SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import {
  executeSponsoredTxHelper,
  expectError,
  getCoinBalance,
  getCreatedObjects,
  SuiTreasuryClient,
  transferCoinHelper
} from "../scripts/helpers";
import { generateKeypairCommand } from "../scripts/generateKeypair";
import { deployCommand } from "../scripts/deploy";

describe("Test coin transfer behavior when compliance controls are enabled", () => {
  const RPC_URL: string = process.env.RPC_URL as string;
  const client = new SuiClient({ url: RPC_URL });
  let treasuryClient: SuiTreasuryClient;

  let deployerKeys: Ed25519Keypair;
  let coinSenderKeys: Ed25519Keypair;
  let sponsorKeys: Ed25519Keypair;
  let coinRecipient: string;
  let mintCapId: string;
  let coinId: string;

  before("Deploy USDC and create coin balance", async () => {
    deployerKeys = await generateKeypairCommand({ prefund: true });
    coinSenderKeys = await generateKeypairCommand({ prefund: true });
    sponsorKeys = await generateKeypairCommand({ prefund: true });
    coinRecipient = (
      await generateKeypairCommand({ prefund: false })
    ).toSuiAddress();

    const upgraderKeys = await generateKeypairCommand({ prefund: false });
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

    await treasuryClient.configureNewController(
      deployerKeys, // master minter
      deployerKeys.toSuiAddress(), // controller
      deployerKeys.toSuiAddress() // minter
    );
    const mintAllowance = BigInt(100) * BigInt(10 ** 6); // 100 USDC
    await treasuryClient.setMintAllowance(deployerKeys, mintAllowance);
    mintCapId = (await treasuryClient.getMintCapId(
      deployerKeys.toSuiAddress()
    )) as string;
  });

  beforeEach("Mint token to coin sender", async () => {
    const mintTxOutput = await treasuryClient.mint(
      deployerKeys,
      mintCapId,
      coinSenderKeys.toSuiAddress(),
      BigInt(1) * BigInt(10 ** 6) // 1 USDC
    );
    coinId = getCreatedObjects(mintTxOutput, {
      objectType: /(?<=coin::Coin<)\w{66}::usdc::USDC(?=>)/
    })[0].objectId;
  });

  it("Account can transfer tokens under normal circumstance", async () => {
    const sender = coinSenderKeys.toSuiAddress();
    const coinType = treasuryClient.coinOtwType;

    const senderBalBefore = await getCoinBalance(client, sender, coinType);
    const recipientBalBefore = await getCoinBalance(
      client,
      coinRecipient,
      coinType
    );

    const result = await transferCoinHelper(
      client,
      coinId,
      coinSenderKeys,
      coinRecipient
    );

    assert.equal(result.effects?.status.status, "success");
    const senderBalAfter = await getCoinBalance(client, sender, coinType);
    const recipientBalAfter = await getCoinBalance(
      client,
      coinRecipient,
      coinType
    );
    assert.equal(senderBalAfter, senderBalBefore - 1000000);
    assert.equal(recipientBalAfter, recipientBalBefore + 1000000);
  });

  it("Outbound transfer permissions are updated immediately after blocklist/unblocklist", async () => {
    const sender = coinSenderKeys.toSuiAddress();
    const coinType = treasuryClient.coinOtwType;

    // Accounts cannot transfer tokens immediately after being blocklisted
    await treasuryClient.setBlocklistState(deployerKeys, sender, true);
    await expectError(
      () => transferCoinHelper(client, coinId, coinSenderKeys, coinRecipient),
      `Address ${sender} is denied for coin ${coinType.slice(2)}`
    );

    // Accounts can resume transferring tokens immediately after being unblocklisted
    await treasuryClient.setBlocklistState(deployerKeys, sender, false);

    const senderBalBefore = await getCoinBalance(client, sender, coinType);
    const recipientBalBefore = await getCoinBalance(
      client,
      coinRecipient,
      coinType
    );

    const result = await transferCoinHelper(
      client,
      coinId,
      coinSenderKeys,
      coinRecipient
    );
    assert.equal(result.effects?.status.status, "success");
    const senderBalAfter = await getCoinBalance(client, sender, coinType);
    const recipientBalAfter = await getCoinBalance(
      client,
      coinRecipient,
      coinType
    );
    assert.equal(senderBalAfter, senderBalBefore - 1000000);
    assert.equal(recipientBalAfter, recipientBalBefore + 1000000);
  });

  it("Outbound transfer permissions are updated immediately after pause/unpause", async () => {
    const sender = coinSenderKeys.toSuiAddress();
    const coinType = treasuryClient.coinOtwType;

    // Accounts cannot transfer tokens immediately after token is paused
    await treasuryClient.setPausedState(deployerKeys, true);
    await expectError(
      () => transferCoinHelper(client, coinId, coinSenderKeys, coinRecipient),
      `Coin type is globally paused for use: ${treasuryClient.coinOtwType.slice(2)}`
    );

    // Accounts can resume transferring tokens immediately after token is unpaused
    await treasuryClient.setPausedState(deployerKeys, false);
    const senderBalBefore = await getCoinBalance(client, sender, coinType);
    const recipientBalBefore = await getCoinBalance(
      client,
      coinRecipient,
      coinType
    );

    const result = await transferCoinHelper(
      client,
      coinId,
      coinSenderKeys,
      coinRecipient
    );

    assert.equal(result.effects?.status.status, "success");
    const senderBalAfter = await getCoinBalance(client, sender, coinType);
    const recipientBalAfter = await getCoinBalance(
      client,
      coinRecipient,
      coinType
    );
    assert.equal(senderBalAfter, senderBalBefore - 1000000);
    assert.equal(recipientBalAfter, recipientBalBefore + 1000000);
  });

  it("Outbound transfer permissions via sponsored transactions are updated immediately after blocklist/unblocklist", async () => {
    const sender = coinSenderKeys.toSuiAddress();
    const coinType = treasuryClient.coinOtwType;

    // Sender cannot transfer tokens via sponsored transactions, immediately after being blocklisted
    await treasuryClient.setBlocklistState(deployerKeys, sender, true);
    await expectError(
      () => {
        const txb = new Transaction();
        txb.transferObjects([coinId], coinRecipient);
        return executeSponsoredTxHelper({
          client,
          txb,
          sender: coinSenderKeys,
          sponsor: sponsorKeys
        });
      },
      `Address ${sender} is denied for coin ${treasuryClient.coinOtwType.slice(2)}`
    );

    // Sender can transfer tokens via sponsored transactions, immediately after being unblocklisted
    await treasuryClient.setBlocklistState(deployerKeys, sender, false);
    const senderBalBefore = await getCoinBalance(client, sender, coinType);
    const recipientBalBefore = await getCoinBalance(
      client,
      coinRecipient,
      coinType
    );

    const txb = new Transaction();
    txb.transferObjects([coinId], coinRecipient);
    const result = await executeSponsoredTxHelper({
      client,
      txb,
      sender: coinSenderKeys,
      sponsor: sponsorKeys
    });
    assert.equal(result.effects?.status.status, "success");
    const senderBalAfter = await getCoinBalance(client, sender, coinType);
    const recipientBalAfter = await getCoinBalance(
      client,
      coinRecipient,
      coinType
    );

    assert.equal(senderBalAfter, senderBalBefore - 1000000);
    assert.equal(recipientBalAfter, recipientBalBefore + 1000000);
  });

  it("Outbound transfer permissions via sponsored transactions are updated immediately after pause/unpause", async () => {
    const sender = coinSenderKeys.toSuiAddress();
    const coinType = treasuryClient.coinOtwType;

    // Sender cannot transfer tokens via sponsored transactions, immediately after token is paused
    await treasuryClient.setPausedState(deployerKeys, true);
    await expectError(
      () => {
        const txb = new Transaction();
        txb.transferObjects([coinId], coinRecipient);
        return executeSponsoredTxHelper({
          client,
          txb,
          sender: coinSenderKeys,
          sponsor: sponsorKeys
        });
      },
      `Coin type is globally paused for use: ${treasuryClient.coinOtwType.slice(2)}`
    );

    // Sender can transfer tokens via sponsored transactions, immediately after token is unpaused
    await treasuryClient.setPausedState(deployerKeys, false);
    const senderBalBefore = await getCoinBalance(client, sender, coinType);
    const recipientBalBefore = await getCoinBalance(
      client,
      coinRecipient,
      coinType
    );

    const txb = new Transaction();
    txb.transferObjects([coinId], coinRecipient);
    const result = await executeSponsoredTxHelper({
      client,
      txb,
      sender: coinSenderKeys,
      sponsor: sponsorKeys
    });
    assert.equal(result.effects?.status.status, "success");
    const senderBalAfter = await getCoinBalance(client, sender, coinType);
    const recipientBalAfter = await getCoinBalance(
      client,
      coinRecipient,
      coinType
    );
    assert.equal(senderBalAfter, senderBalBefore - 1000000);
    assert.equal(recipientBalAfter, recipientBalBefore + 1000000);
  });
});
