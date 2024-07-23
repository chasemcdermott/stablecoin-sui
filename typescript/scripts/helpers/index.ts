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

import { BcsType } from "@mysten/sui/bcs";
import {
  SuiClient,
  SuiObjectChangeCreated,
  SuiObjectChangePublished,
  SuiTransactionBlockResponse
} from "@mysten/sui/client";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { execSync } from "child_process";
import _ from "lodash";
import fs from "fs";
import path from "path";
import readline from "readline/promises";
import util from "util";

export { default as SuiTreasuryClient } from "./treasuryClient";

export const DENY_LIST_OBJECT_ID = "0x403";

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
    const response = await rl.question("Are you sure? (Y/N): ");
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

export function buildPackageHelper(args: {
  packageName: string;
  withUnpublishedDependencies: boolean;
}): {
  modules: string[];
  dependencies: string[];
  digest: number[];
} {
  const packagePath = path.join(
    __dirname,
    `../../../packages/${args.packageName}`
  );
  const withUnpublishedDependenciesArg = !!args.withUnpublishedDependencies
    ? "--with-unpublished-dependencies"
    : "";
  const rawCompiledPackages = execSync(
    `sui move build --dump-bytecode-as-base64 --path ${packagePath} ${withUnpublishedDependenciesArg}`,
    { encoding: "utf-8" }
  );
  return JSON.parse(rawCompiledPackages);
}

export function writePublishedAddressToPackageManifest(
  packageName: string,
  address: string
) {
  const moveTomlFilepath = getMoveTomlFilepath(packageName);
  let existingContent = fs.readFileSync(moveTomlFilepath, "utf-8");

  // Add published-at field.
  existingContent = existingContent.replace(
    "[package]",
    `[package]\npublished-at = "${address}"`
  );

  // Set package alias to address.
  existingContent = existingContent.replace(
    `${packageName} = "0x0"`,
    `${packageName} = "${address}"`
  );

  fs.writeFileSync(moveTomlFilepath, existingContent);

  // Run a build to update the Move.lock file.
  buildPackageHelper({ packageName, withUnpublishedDependencies: false });
}

export function resetPublishedAddressInPackageManifest(packageName: string) {
  const moveTomlFilepath = getMoveTomlFilepath(packageName);
  let existingContent = fs.readFileSync(moveTomlFilepath, "utf-8");

  // Remove published-at field.
  existingContent = existingContent.replace(/\npublished-at.*\w{66}.*/, "");

  // Reset package alias to 0x0.
  existingContent = existingContent.replace(
    new RegExp(`\\n${packageName}.*\\w{66}.*`),
    `\n${packageName} = "0x0"`
  );

  fs.writeFileSync(moveTomlFilepath, existingContent);

  // Run a build to update the Move.lock file.
  buildPackageHelper({ packageName, withUnpublishedDependencies: false });
}

function getMoveTomlFilepath(packageName: string) {
  return path.join(
    __dirname,
    "..",
    "..",
    "..",
    "packages",
    packageName,
    "Move.toml"
  );
}

export async function deployPackageHelper(args: {
  client: SuiClient;
  deployer: Ed25519Keypair;

  modules: string[];
  dependencies: string[];

  upgradeCapRecipient: string | null;
  makeImmutable: boolean;
}): Promise<SuiTransactionBlockResponse> {
  const transaction = new Transaction();

  // Command #1: Publish packages
  const upgradeCap = transaction.publish({
    modules: args.modules,
    dependencies: args.dependencies
  });

  // Command #2: Transfer UpgradeCap / Destroy UpgradeCap
  if (!args.makeImmutable) {
    if (!args.upgradeCapRecipient) {
      throw new Error("Missing required field 'updateCapRecipient'!");
    }
    transaction.transferObjects([upgradeCap], args.upgradeCapRecipient);
  } else {
    transaction.moveCall({
      target: "0x2::package::make_immutable",
      arguments: [upgradeCap]
    });
  }

  return executeTransactionHelper({
    client: args.client,
    signer: args.deployer,
    transaction
  });
}

export async function executeTransactionHelper(args: {
  client: SuiClient;
  signer: Ed25519Keypair;
  transaction: Transaction;
}): Promise<SuiTransactionBlockResponse> {
  const initialTxOutput = await args.client.signAndExecuteTransaction({
    signer: args.signer,
    transaction: args.transaction
  });

  // Wait for the transaction to be available over API
  const txOutput = await args.client.waitForTransaction({
    digest: initialTxOutput.digest,
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
    console.log(inspectObject(txOutput));
    throw new Error("Transaction failed!");
  }

  return txOutput;
}

export async function callViewFunction<T, Input = T>(args: {
  client: SuiClient;

  transaction: Transaction;
  returnTypes: BcsType<T, Input>[];

  sender?: string;
}) {
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
  objectType?: RegExp | string
) {
  let createdObjects = txOutput.objectChanges?.filter(
    (c): c is SuiObjectChangeCreated => c.type === "created"
  );
  if (objectType) {
    createdObjects = createdObjects?.filter((c) =>
      c.objectType.match(objectType)
    );
  }
  return createdObjects || [];
}

export function getPublishedPackages(txOutput: SuiTransactionBlockResponse) {
  return (
    txOutput.objectChanges?.filter(
      (c): c is SuiObjectChangePublished => c.type === "published"
    ) || []
  );
}
