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
import { Transaction } from "@mysten/sui/transactions";
import { generateKeypairCommand } from "../../../scripts/generateKeypair";
import {
  DEFAULT_GAS_BUDGET,
  executeTransactionHelper,
  expectError
} from "../../../scripts/helpers";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { strict as assert } from "assert";

describe("Test helpers", () => {
  const RPC_URL: string = process.env.RPC_URL as string;
  const client = new SuiClient({ url: RPC_URL });

  describe("executeTransactionHelper", () => {
    let transaction: Transaction;
    let signer: Ed25519Keypair;

    beforeEach(async () => {
      signer = await generateKeypairCommand({ prefund: true });

      // Build a successful test transaction.
      transaction = new Transaction();
      transaction.moveCall({
        target: "0x1::u64::min",
        arguments: [transaction.pure.u64(1), transaction.pure.u64(2)]
      });
    });

    it("should execute transaction", async () => {
      const txOutput = await executeTransactionHelper({
        client,
        dryRun: false,
        gasBudget: DEFAULT_GAS_BUDGET,
        signer,
        transaction
      });

      assert(
        (await client.getTransactionBlock({ digest: txOutput.digest })) != null
      );
    });

    it("should throw if transaction execution fails", async () => {
      const failingTx = new Transaction();
      failingTx.moveCall({
        target: "0x1::u64::divide_and_round_up",
        arguments: [failingTx.pure.u64(1), failingTx.pure.u64(0)]
      });

      await expectError(
        () =>
          executeTransactionHelper({
            client,
            dryRun: false,
            gasBudget: DEFAULT_GAS_BUDGET,
            signer,
            transaction: failingTx
          }),
        "MovePrimitiveRuntimeError"
      );
    });

    it("should dry run transaction", async () => {
      const txOutput = await executeTransactionHelper({
        client,
        dryRun: true,
        gasBudget: DEFAULT_GAS_BUDGET,
        signer,
        transaction
      });

      await expectError(
        () =>
          client.getTransactionBlock({
            digest: txOutput.effects.transactionDigest
          }),
        "Could not find the referenced transaction"
      );
    });
  });
});
