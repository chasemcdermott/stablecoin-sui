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
import { program } from "commander";
import {
  inspectObject,
  log,
  waitForTransaction,
  writeJsonOutput
} from "./helpers";

export async function executeTransaction(options: {
  rpcUrl: string;
  txBytes: string;
  dryRun?: boolean;
  signatures?: string[];
}) {
  const client = new SuiClient({ url: options.rpcUrl });

  if (options.dryRun) {
    log("Dry running transaction...");

    const result = await client.dryRunTransactionBlock({
      transactionBlock: options.txBytes
    });

    log(inspectObject(result));
    return result;
  } else {
    log("Executing transaction...");

    if (options.signatures == null) {
      throw new Error("Missing required signatures for transaction execution!");
    }

    const initialTxOutput = await client.executeTransactionBlock({
      transactionBlock: options.txBytes,
      signature: options.signatures
    });
    const txOutput = await waitForTransaction({
      client,
      transactionDigest: initialTxOutput.digest
    });

    log(inspectObject(txOutput));
    writeJsonOutput("execute-transaction", txOutput);
    return txOutput;
  }
}

export default program
  .createCommand("execute-transaction")
  .description("Executes a transaction")
  .requiredOption(
    "--tx-bytes <string>",
    "Base64 encoded, BCS-serialized TransactionData"
  )
  .option("--dry-run", "Dry runs the transaction if set")
  .option("--signatures [string...]", "Required if --dry-run is unset")
  .requiredOption(
    "-r, --rpc-url <string>",
    "Network RPC URL",
    process.env.RPC_URL
  )
  .action(async (options) => {
    await executeTransaction(options);
  });
