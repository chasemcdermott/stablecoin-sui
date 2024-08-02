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
  DEFAULT_GAS_BUDGET,
  getCoinBalance,
  getCreatedObjects,
  SuiTreasuryClient,
  transferCoinHelper
} from "../scripts/helpers";
import { generateKeypairCommand } from "../scripts/generateKeypair";
import { deployCommand } from "../scripts/deploy";
import { waitUntilNextEpoch } from "./utils";

describe("Test coin transfer behavior when compliance controls are enabled", () => {
  const RPC_URL: string = process.env.RPC_URL as string;
  const client = new SuiClient({ url: RPC_URL });
  let treasuryClient: SuiTreasuryClient;

  let deployerKeys: Ed25519Keypair;
  let upgraderKeys: Ed25519Keypair;
  let coinSenderKeys: Ed25519Keypair;
  let sponsorKeys: Ed25519Keypair;
  let coinRecipient: string;
  let mintCapId: string;
  let coinId: string;

  before("Setup keys", async () => {
    deployerKeys = await generateKeypairCommand({ prefund: true });
    coinSenderKeys = await generateKeypairCommand({ prefund: true });
    sponsorKeys = await generateKeypairCommand({ prefund: true });
    coinRecipient = (
      await generateKeypairCommand({ prefund: false })
    ).toSuiAddress();
    upgraderKeys = await generateKeypairCommand({ prefund: false });
  });

  beforeEach("Deploy USDC, mint token to coin sender", async () => {
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

    await treasuryClient.configureNewController(
      deployerKeys, // master minter
      deployerKeys.toSuiAddress(), // controller
      deployerKeys.toSuiAddress(), // minter
      { gasBudget: DEFAULT_GAS_BUDGET }
    );
    const mintAllowance = BigInt(100) * BigInt(10 ** 6); // 100 USDC
    await treasuryClient.setMintAllowance(deployerKeys, mintAllowance, {
      gasBudget: DEFAULT_GAS_BUDGET
    });
    mintCapId = (await treasuryClient.getMintCapId(
      deployerKeys.toSuiAddress()
    )) as string;

    const mintTxOutput = await treasuryClient.mint(
      deployerKeys,
      mintCapId,
      coinSenderKeys.toSuiAddress(),
      BigInt(1) * BigInt(10 ** 6), // 1 USDC
      { gasBudget: DEFAULT_GAS_BUDGET }
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
      coinRecipient,
      { gasBudget: DEFAULT_GAS_BUDGET }
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
    await treasuryClient.setBlocklistState(deployerKeys, sender, true, {
      gasBudget: DEFAULT_GAS_BUDGET
    });
    await expectError(
      () =>
        transferCoinHelper(client, coinId, coinSenderKeys, coinRecipient, {
          gasBudget: DEFAULT_GAS_BUDGET
        }),
      `Address ${sender} is denied for coin ${coinType.slice(2)}`
    );

    // Accounts can resume transferring tokens immediately after being unblocklisted
    await treasuryClient.setBlocklistState(deployerKeys, sender, false, {
      gasBudget: DEFAULT_GAS_BUDGET
    });

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
      coinRecipient,
      { gasBudget: DEFAULT_GAS_BUDGET }
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

  it("Outbound transfer permissions are updated immediately after pause", async () => {
    // Accounts cannot transfer tokens immediately after token is paused
    await treasuryClient.setPausedState(deployerKeys, true, {
      gasBudget: DEFAULT_GAS_BUDGET
    });
    await expectError(
      () =>
        transferCoinHelper(client, coinId, coinSenderKeys, coinRecipient, {
          gasBudget: DEFAULT_GAS_BUDGET
        }),
      `Coin type is globally paused for use: ${treasuryClient.coinOtwType.slice(2)}`
    );
  });

  it("Outbound transfer permissions are updated by the next epoch after unpause", async () => {
    const sender = coinSenderKeys.toSuiAddress();
    const coinType = treasuryClient.coinOtwType;

    // Accounts cannot transfer tokens immediately after token is paused
    await treasuryClient.setPausedState(deployerKeys, true, {
      gasBudget: DEFAULT_GAS_BUDGET
    });
    await waitUntilNextEpoch(client);

    // Ensure that the pause has fully take effect for both outbound and inbound transfers.
    assert.equal(await treasuryClient.isPaused("current"), true);
    assert.equal(await treasuryClient.isPaused("next"), true);

    // Accounts can resume transferring tokens by the next epoch after token is unpaused
    await treasuryClient.setPausedState(deployerKeys, false, {
      gasBudget: DEFAULT_GAS_BUDGET
    });
    await waitUntilNextEpoch(client);

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
      coinRecipient,
      { gasBudget: DEFAULT_GAS_BUDGET }
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
    await treasuryClient.setBlocklistState(deployerKeys, sender, true, {
      gasBudget: DEFAULT_GAS_BUDGET
    });
    await expectError(
      () => {
        const txb = new Transaction();
        txb.transferObjects([coinId], coinRecipient);
        return executeSponsoredTxHelper({
          client,
          txb,
          sender: coinSenderKeys,
          sponsor: sponsorKeys,
          gasBudget: DEFAULT_GAS_BUDGET
        });
      },
      `Address ${sender} is denied for coin ${treasuryClient.coinOtwType.slice(2)}`
    );

    // Sender can transfer tokens via sponsored transactions, immediately after being unblocklisted
    await treasuryClient.setBlocklistState(deployerKeys, sender, false, {
      gasBudget: DEFAULT_GAS_BUDGET
    });
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
      sponsor: sponsorKeys,
      gasBudget: DEFAULT_GAS_BUDGET
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

  it("Outbound transfer permissions via sponsored transactions are updated immediately after pause", async () => {
    // Sender cannot transfer tokens via sponsored transactions, immediately after token is paused
    await treasuryClient.setPausedState(deployerKeys, true, {
      gasBudget: DEFAULT_GAS_BUDGET
    });
    await expectError(
      () => {
        const txb = new Transaction();
        txb.transferObjects([coinId], coinRecipient);
        return executeSponsoredTxHelper({
          client,
          txb,
          sender: coinSenderKeys,
          sponsor: sponsorKeys,
          gasBudget: DEFAULT_GAS_BUDGET
        });
      },
      `Coin type is globally paused for use: ${treasuryClient.coinOtwType.slice(2)}`
    );
  });

  it("Outbound transfer permissions via sponsored transactions are updated by the next epoch after unpause", async () => {
    const sender = coinSenderKeys.toSuiAddress();
    const coinType = treasuryClient.coinOtwType;

    // Accounts cannot transfer tokens immediately after token is paused
    await treasuryClient.setPausedState(deployerKeys, true, {
      gasBudget: DEFAULT_GAS_BUDGET
    });
    await waitUntilNextEpoch(client);

    // Ensure that the pause has fully take effect for both outbound and inbound transfers.
    assert.equal(await treasuryClient.isPaused("current"), true);
    assert.equal(await treasuryClient.isPaused("next"), true);

    // Sender can transfer tokens via sponsored transactions by the next epoch after token is unpaused
    await treasuryClient.setPausedState(deployerKeys, false, {
      gasBudget: DEFAULT_GAS_BUDGET
    });
    await waitUntilNextEpoch(client);

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
      sponsor: sponsorKeys,
      gasBudget: DEFAULT_GAS_BUDGET
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
