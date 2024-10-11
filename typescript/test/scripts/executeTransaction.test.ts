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

import { bcs } from "@mysten/sui/bcs";
import { SuiClient } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { executeTransaction } from "../../scripts/executeTransaction";
import { generateKeypairCommand } from "../../scripts/generateKeypair";
import { DEFAULT_GAS_BUDGET, expectError } from "../../scripts/helpers";
import { strict as assert } from "assert";

describe("Test execute-transaction", () => {
  const RPC_URL: string = process.env.RPC_URL as string;
  const client = new SuiClient({ url: RPC_URL });

  let encodedTxBytes: string;
  let signatures: string[];

  beforeEach(async () => {
    const sender = await generateKeypairCommand({ prefund: true });

    // Build a test transaction.
    const tx = new Transaction();
    tx.moveCall({
      target: "0x1::u64::min",
      arguments: [tx.pure.u64(1), tx.pure.u64(2)]
    });
    tx.setSender(sender.toSuiAddress());
    tx.setGasBudget(DEFAULT_GAS_BUDGET);

    const txBytes = await tx.build({
      client,
      onlyTransactionKind: false
    });

    // Encode the transaction and gather a signature for its execution.
    encodedTxBytes = bcs.TransactionData.serialize(
      bcs.TransactionData.parse(txBytes)
    ).toBase64();
    signatures = [(await sender.signTransaction(txBytes)).signature];
  });

  it("should dry run transaction if --dry-run is set", async () => {
    // Dry run the transaction.
    const result = await executeTransaction({
      rpcUrl: RPC_URL,
      dryRun: true,
      txBytes: encodedTxBytes
    });

    // Check that the dry run succeeded.
    assert.equal(result.effects?.status.status, "success");

    // Ensure that the transaction is not submitted.
    const digest = result.effects.transactionDigest;
    await expectError(
      () => client.getTransactionBlock({ digest }),
      "Could not find the referenced transaction"
    );
  });

  it("should execute transaction", async () => {
    // Execute the transaction.
    const result = await executeTransaction({
      rpcUrl: RPC_URL,
      txBytes: encodedTxBytes,
      signatures
    });

    // Check that the execution succeeded.
    assert.equal(result.effects?.status.status, "success");

    // Ensure that the transaction is submitted.
    const digest = result.effects.transactionDigest;
    assert((await client.getTransactionBlock({ digest })) != null);
  });
});
