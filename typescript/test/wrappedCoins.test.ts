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

import { strict as assert } from "assert";
import { SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import {
  expectError,
  DEFAULT_GAS_BUDGET,
  getCreatedObjects,
  SuiTreasuryClient,
  executeTransactionHelper,
  getPublishedPackages
} from "../scripts/helpers";
import { generateKeypairCommand } from "../scripts/generateKeypair";
import { deployCommand } from "../scripts/deploy";
import { waitUntilNextEpoch } from "./utils";

describe("Test coin transfer behavior when pause is enabled", () => {
  const RPC_URL: string = process.env.RPC_URL as string;
  const client = new SuiClient({ url: RPC_URL });
  let treasuryClient: SuiTreasuryClient;

  let deployerKeys: Ed25519Keypair;
  let upgraderKeys: Ed25519Keypair;
  let aliceKeys: Ed25519Keypair;
  let bobKeys: Ed25519Keypair;
  let mintCapId: string;
  let coinId: string;
  let coinStorePackageId: string;

  const AMOUNT: number = 1000000; // 1 USDC

  before("Setup keys", async () => {
    deployerKeys = await generateKeypairCommand({ prefund: true });
    upgraderKeys = await generateKeypairCommand({ prefund: false });
    aliceKeys = await generateKeypairCommand({ prefund: true });
    bobKeys = await generateKeypairCommand({ prefund: true });

    const coinStoreDeployTxOutput = await deployCommand("mock/coin_store", {
      rpcUrl: RPC_URL,
      deployerKey: deployerKeys.getSecretKey(),
      upgradeCapRecipient: upgraderKeys.toSuiAddress(),
      gasBudget: DEFAULT_GAS_BUDGET.toString()
    });
    const publishedIds = getPublishedPackages(coinStoreDeployTxOutput);
    assert.equal(publishedIds.length, 1);
    coinStorePackageId = publishedIds[0].packageId;
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
      aliceKeys.toSuiAddress(),
      BigInt(AMOUNT), // 1 USDC
      { gasBudget: DEFAULT_GAS_BUDGET }
    );
    coinId = getCreatedObjects(mintTxOutput, {
      objectType: /(?<=coin::Coin<)\w{66}::usdc::USDC(?=>)/
    })[0].objectId;
  });

  it("Unwrap and transfer to a blocklisted address is allowed before the next epoch", async () => {
    const coinStoreId = await wrapAndTransferCoin({
      coinStorePackageId,
      treasuryClient,
      sender: aliceKeys,
      recipient: bobKeys.toSuiAddress(),
      coinId
    });
    const aliceAddr = aliceKeys.toSuiAddress();

    // Wait till a new epoch to prevent flaky test
    await waitUntilNextEpoch(client);
    await treasuryClient.setBlocklistState(deployerKeys, aliceAddr, true, {
      gasBudget: DEFAULT_GAS_BUDGET
    });
    assert.equal(
      await treasuryClient.isBlocklisted(aliceAddr, "current"),
      false
    );
    assert.equal(await treasuryClient.isBlocklisted(aliceAddr, "next"), true);

    await unwrapAndTransferCoin({
      coinStorePackageId,
      treasuryClient,
      sender: bobKeys,
      recipient: aliceKeys.toSuiAddress(),
      coinStoreId
    });
  });

  it("Unwrap and transfer to a blocklisted address is disallowed after the next epoch", async () => {
    const coinStoreId = await wrapAndTransferCoin({
      coinStorePackageId,
      treasuryClient,
      sender: aliceKeys,
      recipient: bobKeys.toSuiAddress(),
      coinId
    });
    const aliceAddr = aliceKeys.toSuiAddress();
    await treasuryClient.setBlocklistState(deployerKeys, aliceAddr, true, {
      gasBudget: DEFAULT_GAS_BUDGET
    });
    await waitUntilNextEpoch(client);
    assert.equal(
      await treasuryClient.isBlocklisted(aliceAddr, "current"),
      true
    );
    assert.equal(await treasuryClient.isBlocklisted(aliceAddr, "next"), true);

    await expectError(
      () =>
        unwrapAndTransferCoin({
          coinStorePackageId,
          treasuryClient,
          sender: bobKeys,
          recipient: aliceKeys.toSuiAddress(),
          coinStoreId
        }),
      `AddressDeniedForCoin { address: ${aliceAddr}, coin_type: "${treasuryClient.coinOtwType.slice(2)}" }`
    );
  });

  it("Unwrap and transfer during a pause is allowed before the next epoch", async () => {
    const coinStoreId = await wrapAndTransferCoin({
      coinStorePackageId,
      treasuryClient,
      sender: aliceKeys,
      recipient: bobKeys.toSuiAddress(),
      coinId
    });

    // Wait till a new epoch to prevent flaky test
    await waitUntilNextEpoch(client);
    await treasuryClient.setPausedState(deployerKeys, true, {
      gasBudget: DEFAULT_GAS_BUDGET
    });

    assert.equal(await treasuryClient.isPaused("current"), false);
    assert.equal(await treasuryClient.isPaused("next"), true);

    await unwrapAndTransferCoin({
      coinStorePackageId,
      treasuryClient,
      sender: bobKeys,
      recipient: aliceKeys.toSuiAddress(),
      coinStoreId
    });
  });

  it("Unwrap and transfer during a pause is disallowed after the next epoch", async () => {
    const coinStoreId = await wrapAndTransferCoin({
      coinStorePackageId,
      treasuryClient,
      sender: aliceKeys,
      recipient: bobKeys.toSuiAddress(),
      coinId
    });
    await treasuryClient.setPausedState(deployerKeys, true, {
      gasBudget: DEFAULT_GAS_BUDGET
    });

    await waitUntilNextEpoch(client);
    assert.equal(await treasuryClient.isPaused("current"), true);
    assert.equal(await treasuryClient.isPaused("next"), true);

    await expectError(
      () =>
        unwrapAndTransferCoin({
          coinStorePackageId,
          treasuryClient,
          sender: bobKeys,
          recipient: aliceKeys.toSuiAddress(),
          coinStoreId
        }),
      `CoinTypeGlobalPause { coin_type: "${treasuryClient.coinOtwType.slice(2)}" }`
    );
  });
});

async function wrapAndTransferCoin({
  coinStorePackageId,
  treasuryClient,
  sender,
  recipient,
  coinId,
  gasBudget = DEFAULT_GAS_BUDGET
}: {
  coinStorePackageId: string;
  treasuryClient: SuiTreasuryClient;
  sender: Ed25519Keypair;
  recipient: string;
  coinId: string;
  gasBudget?: bigint;
}): Promise<string> {
  const { suiClient: client, coinOtwType } = treasuryClient;

  const txb = new Transaction();
  txb.moveCall({
    target: `${coinStorePackageId}::coin_store::wrap_and_transfer`,
    typeArguments: [coinOtwType],
    arguments: [txb.object(coinId), txb.object(recipient)]
  });

  const txOutput = await executeTransactionHelper({
    dryRun: false,
    client,
    signer: sender,
    transaction: txb,
    gasBudget: gasBudget ?? null
  });

  const createdCoinStores = await getCreatedObjects(txOutput, {
    objectType: /(?<=coin_store::CoinStore<)\w{66}::\w*::\w*(?=>)/
  });
  assert.equal(createdCoinStores.length, 1);
  return createdCoinStores[0].objectId;
}

async function unwrapAndTransferCoin({
  coinStorePackageId,
  treasuryClient,
  sender,
  recipient,
  coinStoreId,
  gasBudget = DEFAULT_GAS_BUDGET
}: {
  coinStorePackageId: string;
  treasuryClient: SuiTreasuryClient;
  sender: Ed25519Keypair;
  recipient: string;
  coinStoreId: string;
  gasBudget?: bigint;
}): Promise<string> {
  const { suiClient: client, coinOtwType } = treasuryClient;

  const txb = new Transaction();
  txb.moveCall({
    target: `${coinStorePackageId}::coin_store::unwrap_and_transfer`,
    typeArguments: [coinOtwType],
    arguments: [txb.object(coinStoreId), txb.object(recipient)]
  });

  const { effects } = await executeTransactionHelper({
    dryRun: false,
    client,
    signer: sender,
    transaction: txb,
    gasBudget: gasBudget ?? null
  });
  assert.equal(effects?.unwrapped?.length, 1);
  return effects.unwrapped[0].reference.objectId;
}
