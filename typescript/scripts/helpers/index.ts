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
import { BcsType } from "@mysten/sui/bcs";
import {
  SuiEvent,
  SuiClient,
  PaginatedEvents,
  SuiObjectChange,
  DynamicFieldInfo,
  DynamicFieldPage,
  SuiObjectChangeCreated,
  SuiObjectChangeMutated,
  SuiObjectChangePublished,
  SuiTransactionBlockResponse,
  DryRunTransactionBlockResponse
} from "@mysten/sui/client";
import {
  isValidSuiAddress,
  MIST_PER_SUI,
  normalizeSuiObjectId
} from "@mysten/sui/utils";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import _ from "lodash";
import fs from "fs";
import path from "path";
import readline from "readline/promises";
import util from "util";
import { string as yupString } from "yup";

export { default as SuiTreasuryClient } from "./treasuryClient";

export const DENY_LIST_OBJECT_ID = normalizeSuiObjectId("0x403");
export const DEFAULT_GAS_BUDGET = BigInt(1) * MIST_PER_SUI; // 1 SUI

export class TransactionError extends Error {
  transactionOutput: SuiTransactionBlockResponse;

  constructor(
    message: string | undefined,
    transactionOutput: SuiTransactionBlockResponse
  ) {
    super(message);
    this.transactionOutput = transactionOutput;
  }
}

export function log(...[message, ...args]: Parameters<typeof console.log>) {
  if (process.env.NODE_ENV !== "TESTING") {
    console.log(">>> " + message, ...args);
  }
}

export function inspectObject(object: any) {
  return util.inspect(
    object,
    false /* showHidden */,
    8 /* depth */,
    true /* color */
  );
}

export async function waitForUserConfirmation() {
  if (process.env.NODE_ENV === "TESTING") {
    return true;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  let userResponse: boolean;

  while (true) {
    const response = (await rl.question("Are you sure? (Y/N): ")).toUpperCase();
    if (response != "Y" && response != "N") {
      continue;
    }
    userResponse = response === "Y";
    break;
  }
  rl.close();

  return userResponse;
}

export function writeJsonOutput(filePrefix: string, output: Record<any, any>) {
  if (process.env.NODE_ENV !== "TESTING") {
    const randomString = new Date().getTime().toString();
    const outputDirectory = path.join(__dirname, "../../logs/");
    const outputFilepath = path.join(
      outputDirectory,
      `${filePrefix}-${randomString}.json`
    );
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(outputFilepath, JSON.stringify(output, null, 2));

    log(`Logs written to ${outputFilepath}`);
  }
}

export function readTransactionOutput(
  jsonFilePath: string
): SuiTransactionBlockResponse {
  return JSON.parse(fs.readFileSync(jsonFilePath, "utf-8"));
}

// Turn private key into keypair format
// cuts off 1st byte as it signifies which signature type is used.
export function getEd25519KeypairFromPrivateKey(privateKey: string) {
  return Ed25519Keypair.fromSecretKey(
    decodeSuiPrivateKey(privateKey).secretKey
  );
}

export async function executeTransactionHelper<
  DryRunEnabled extends boolean
>(args: {
  dryRun: DryRunEnabled;
  signer: Ed25519Keypair;
  client: SuiClient;
  transaction: Transaction;
  gasBudget: bigint | null;
}): Promise<
  DryRunEnabled extends true
    ? DryRunTransactionBlockResponse
    : SuiTransactionBlockResponse
> {
  if (args.gasBudget) {
    args.transaction.setGasBudget(args.gasBudget);
  }

  args.transaction.setSenderIfNotSet(args.signer.toSuiAddress());

  const transactionBlock = await args.transaction.build({
    client: args.client,
    onlyTransactionKind: false
  });

  // Logically, dry running only requires the unsigned transaction. As such, it
  // does not require the signer keypair to be passed in. However, in all context
  // that this function is called, the transaction's signer is available. For code
  // cleanliness purposes, the signer parameter is retained.
  if (args.dryRun) {
    return args.client.dryRunTransactionBlock({
      transactionBlock
    }) as any;
  }

  const signedTx = await args.signer.signTransaction(transactionBlock);
  const initialTxOutput = await args.client.executeTransactionBlock({
    transactionBlock: signedTx.bytes,
    signature: signedTx.signature
  });

  return waitForTransaction({
    client: args.client,
    transactionDigest: initialTxOutput.digest
  }) as any;
}

export async function waitForTransaction(args: {
  client: SuiClient;
  transactionDigest: string;
}): Promise<SuiTransactionBlockResponse> {
  // Wait for the transaction to be available over API
  const txOutput = await args.client.waitForTransaction({
    digest: args.transactionDigest,
    options: {
      showBalanceChanges: true,
      showEffects: true,
      showEvents: true,
      showInput: true,
      showObjectChanges: true,
      showRawInput: false // too verbose
    }
  });

  if (txOutput.effects?.status.status === "failure") {
    throw new TransactionError(txOutput.effects.status.error, txOutput);
  }

  return txOutput;
}

export async function callViewFunction<T, Input = T>(args: {
  client: SuiClient;

  transaction: Transaction;
  returnTypes: BcsType<T, Input>[];

  sender?: string;
}) {
  args.transaction.setGasBudget(DEFAULT_GAS_BUDGET);

  const { results } = await args.client.devInspectTransactionBlock({
    sender:
      args.sender ||
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    transactionBlock: args.transaction
  });

  const returnValues = results?.[0]?.returnValues;
  if (!returnValues) {
    throw new Error("Missing return values!");
  }

  if (returnValues.length != args.returnTypes.length) {
    throw new Error("Mismatched return values and return types!");
  }

  // returnValues has the shape of [Byte[], Type][]
  const returnValueBytes = returnValues.map((v) => new Uint8Array(v[0]));
  const decodedResults = _.zip(args.returnTypes, returnValueBytes).map(
    ([type, bytes]) => type!.parse(bytes!)
  );

  return decodedResults;
}

export function getCreatedObjects(
  txOutput: SuiTransactionBlockResponse,
  filters?: { objectId?: string; objectType?: RegExp | string }
): SuiObjectChangeCreated[] {
  return getObjectsByType("created", txOutput, filters ?? {});
}

export function getMutatedObjects(
  txOutput: SuiTransactionBlockResponse,
  filters?: { objectId?: string; objectType?: RegExp | string }
): SuiObjectChangeMutated[] {
  return getObjectsByType("mutated", txOutput, filters ?? {});
}

export function getPublishedPackages(txOutput: {
  objectChanges?: SuiObjectChange[] | null;
}): SuiObjectChangePublished[] {
  return getObjectsByType("published", txOutput, {});
}

function getObjectsByType<T extends SuiObjectChange>(
  type: SuiObjectChange["type"],
  txOutput: { objectChanges?: SuiObjectChange[] | null },
  filters: { objectId?: string; objectType?: RegExp | string }
) {
  let objects = txOutput.objectChanges?.filter((c): c is T => c.type === type);
  const { objectId, objectType } = filters;
  if (objectId && type != "published") {
    objects = (objects as Exclude<T, { type: "published" }>[]).filter((c) =>
      c.objectId.match(objectId)
    );
  }
  if (objectType && type != "published") {
    objects = (objects as Exclude<T, { type: "published" }>[]).filter((c) =>
      c.objectType.match(objectType)
    );
  }
  return objects || [];
}

export async function executeSponsoredTxHelper({
  client,
  txb,
  sender,
  sponsor,
  gasBudget
}: {
  client: SuiClient;
  txb: Transaction;
  sender: Ed25519Keypair;
  sponsor: Ed25519Keypair;
  gasBudget: bigint | null;
}): Promise<SuiTransactionBlockResponse> {
  const payment = await getGasCoinsFromAddress(client, sponsor.toSuiAddress());

  txb.setSender(sender.toSuiAddress());
  txb.setGasOwner(sponsor.toSuiAddress());
  txb.setGasPayment(payment);
  if (gasBudget) {
    txb.setGasBudget(gasBudget);
  }

  const txBytes = await txb.build({ client });

  // Transaction needs to be signed by both the sender and the sponsor
  const sponsoredBytes = await sponsor.signTransaction(txBytes);
  const senderBytes = await sender.signTransaction(txBytes);

  const txOutput = await client.executeTransactionBlock({
    transactionBlock: txBytes,
    signature: [senderBytes.signature, sponsoredBytes.signature],
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
      showBalanceChanges: true
    }
  });

  if (txOutput.effects?.status.status === "failure") {
    throw new TransactionError(txOutput.effects.status.error, txOutput);
  }

  return txOutput;
}

export async function getCoinBalance(
  client: SuiClient,
  owner: string,
  coinType: string
): Promise<number> {
  return parseInt((await client.getBalance({ owner, coinType })).totalBalance);
}

export async function expectError(
  errBlock: () => Promise<any> | any,
  errDescription: string | RegExp
) {
  await assert.rejects(errBlock, (err: any) => {
    if (_.isRegExp(errDescription)) {
      assert.match(err.message, errDescription);
    } else {
      const isErrorFound = err.message.includes(errDescription);
      if (!isErrorFound) {
        console.error(err);
      }
      return isErrorFound;
    }
    return true;
  });
}

export async function getGasCoinsFromAddress(client: SuiClient, owner: string) {
  const coins = await client.getCoins({ owner, limit: 1 });
  if (!coins.data.length) throw new Error("Gas coin not found");
  return coins.data.map((coin) => ({
    objectId: coin.coinObjectId,
    version: coin.version,
    digest: coin.digest
  }));
}

// TODO: Add tests to validate pagination
export async function getEventsByType(
  suiClient: SuiClient,
  stablecoinPackageId: string,
  coinOtwType: string,
  eventType: string
) {
  let events: SuiEvent[] = [];
  let nextCursor: PaginatedEvents["nextCursor"] = undefined;

  do {
    log(
      `Querying events of type '${eventType}' from cursor '${JSON.stringify(nextCursor)}'`
    );

    const response = await suiClient.queryEvents({
      query: {
        MoveEventType: `${stablecoinPackageId}::treasury::${eventType}<${coinOtwType}>`
      },
      cursor: nextCursor
    });

    events = events.concat(response.data);
    nextCursor = response.hasNextPage ? response.nextCursor : undefined;
  } while (nextCursor != null);

  if (!events) {
    throw new Error(`Can't find event for ${eventType}`);
  }

  return events;
}

/**
 * Exhaustively reads a table's entries.
 * TODO: Add tests to validate pagination.
 */
export async function getTableContent(
  suiClient: SuiClient,
  tableId: string
): Promise<DynamicFieldInfo[]> {
  let dfo: DynamicFieldInfo[] = [];
  let nextCursor: DynamicFieldPage["nextCursor"] = null;

  do {
    log(`Querying table of id '${tableId}' from cursor '${nextCursor}'`);

    const response = await suiClient.getDynamicFields({
      parentId: tableId,
      cursor: nextCursor
    });

    dfo = dfo.concat(response.data);
    nextCursor = response.hasNextPage ? response.nextCursor : null;
  } while (nextCursor != null);

  return dfo;
}

export function yupSuiAddressOrEmpty() {
  return yupString().test({
    name: "is-sui-address-or-empty",
    message: "${path} must be a valid Sui address or empty string",
    test: (value) => value === "" || (!!value && isValidSuiAddress(value))
  });
}

export function yupSuiAddress() {
  return yupSuiAddressOrEmpty().test({
    name: "is-sui-address",
    message: "${path} must be a valid Sui address",
    test: (value) => value !== ""
  });
}