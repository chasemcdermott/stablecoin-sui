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

import { bcs, BcsType } from "@mysten/sui/bcs";
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
    const outputDirectory = path.join(__dirname, "../logs/");
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
    `../../packages/${args.packageName}`
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

export class SuiTreasuryClient {
  suiClient: SuiClient;
  treasuryObjectId: string;
  stablecoinPackageId: string;
  coinOtwType: string;
  metadataObjectId?: string;

  public constructor(
    suiClient: SuiClient,
    treasuryObjectId: string,
    stablecoinPackageId: string,
    coinOtwType: string,
    metadataObjectId?: string
  ) {
    this.suiClient = suiClient;
    this.treasuryObjectId = treasuryObjectId;
    this.stablecoinPackageId = stablecoinPackageId;
    this.coinOtwType = coinOtwType;
    this.metadataObjectId = metadataObjectId;
  }

  public static async buildFromId(
    suiClient: SuiClient,
    treasuryObjectId: string,
    metadataObjectId?: string
  ) {
    const treasuryObject = await suiClient.getObject({
      id: treasuryObjectId,
      options: {
        showType: true
      }
    });
    if (!treasuryObject.data?.type) {
      throw new Error("Failed to retrieve treasury object type");
    }
    const treasuryType = treasuryObject.data.type;

    return this.buildHelper(
      suiClient,
      treasuryObjectId,
      treasuryType,
      metadataObjectId
    );
  }

  public static buildFromDeployment(
    suiClient: SuiClient,
    deploymentTxOutput: SuiTransactionBlockResponse
  ) {
    const treasuryObjects = getCreatedObjects(
      deploymentTxOutput,
      /(?<=treasury::Treasury<)\w{66}::\w*::\w*(?=>)/
    );
    if (treasuryObjects.length !== 1) {
      throw new Error("Expected to have one treasury object in the tx output");
    }
    const treasuryObjectId = treasuryObjects[0].objectId;
    const treasuryType = treasuryObjects[0].objectType;

    const metadataIds = getCreatedObjects(
      deploymentTxOutput,
      /(?<=coin::CoinMetadata<)\w{66}::\w*::\w*(?=>)/
    );
    if (metadataIds.length !== 1) {
      throw new Error("Expected to have one metadata object in the tx output");
    }
    const metadataObjectId = metadataIds[0].objectId;

    return this.buildHelper(
      suiClient,
      treasuryObjectId,
      treasuryType,
      metadataObjectId
    );
  }

  private static buildHelper(
    suiClient: SuiClient,
    treasuryObjectId: string,
    treasuryType: string,
    metadataObjectId?: string
  ) {
    const stablecoinPackageId = treasuryType.split("::")[0];
    const coinOtwType = treasuryType.match(
      /(?<=treasury::Treasury<)\w{66}::\w*::\w*(?=>)/
    )?.[0];
    if (!coinOtwType) {
      throw new Error("Failed to parse coin OTW type");
    }
    return new SuiTreasuryClient(
      suiClient,
      treasuryObjectId,
      stablecoinPackageId,
      coinOtwType,
      metadataObjectId
    );
  }

  async configureNewController(
    masterMinter: Ed25519Keypair,
    controllerAddress: string,
    minterAddress: string
  ) {
    const txb = new Transaction();
    txb.moveCall({
      target: `${this.stablecoinPackageId}::treasury::configure_new_controller`,
      typeArguments: [this.coinOtwType],
      arguments: [
        txb.object(this.treasuryObjectId),
        txb.pure.address(controllerAddress),
        txb.pure.address(minterAddress)
      ]
    });
    return executeTransactionHelper({
      client: this.suiClient,
      signer: masterMinter,
      transaction: txb
    });
  }

  async setMintAllowance(controller: Ed25519Keypair, mintAllowance: number) {
    const txb = new Transaction();
    txb.moveCall({
      target: `${this.stablecoinPackageId}::treasury::configure_minter`,
      typeArguments: [this.coinOtwType],
      arguments: [
        txb.object(this.treasuryObjectId),
        txb.object(DENY_LIST_OBJECT_ID),
        txb.pure.u64(mintAllowance)
      ]
    });
    return executeTransactionHelper({
      client: this.suiClient,
      signer: controller,
      transaction: txb
    });
  }

  async rotateController(
    masterMinter: Ed25519Keypair,
    newControllerAddress: string,
    oldControllerAddress: string,
    mintCapId: string
  ) {
    const txb = new Transaction();
    txb.moveCall({
      target: `${this.stablecoinPackageId}::treasury::configure_controller`,
      typeArguments: [this.coinOtwType],
      arguments: [
        txb.object(this.treasuryObjectId),
        txb.object(newControllerAddress),
        txb.pure.id(mintCapId)
      ]
    });
    txb.moveCall({
      target: `${this.stablecoinPackageId}::treasury::remove_controller`,
      typeArguments: [this.coinOtwType],
      arguments: [
        txb.object(this.treasuryObjectId),
        txb.object(oldControllerAddress)
      ]
    });
    return executeTransactionHelper({
      client: this.suiClient,
      signer: masterMinter,
      transaction: txb
    });
  }

  async updateMetadata(
    owner: Ed25519Keypair,
    name: string,
    symbol: string,
    desc: string,
    iconUrl: string
  ) {
    if (!this.metadataObjectId) {
      throw new Error("Unknown metadata object ID");
    }
    const txb = new Transaction();
    txb.moveCall({
      target: `${this.stablecoinPackageId}::treasury::update_metadata`,
      typeArguments: [this.coinOtwType],
      arguments: [
        txb.object(this.treasuryObjectId),
        txb.object(this.metadataObjectId),
        txb.pure.string(name),
        txb.pure.string(symbol),
        txb.pure.string(desc),
        txb.pure.string(iconUrl)
      ]
    });

    return executeTransactionHelper({
      client: this.suiClient,
      signer: owner,
      transaction: txb
    });
  }

  async getMintCapOwner(mintCapId: string) {
    const mintCap = await this.suiClient.getObject({
      id: mintCapId,
      options: {
        showOwner: true
      }
    });
    return (mintCap.data?.owner as any).AddressOwner;
  }

  async getMintAllowance(mintCapId: string) {
    const getAllowanceTx = new Transaction();
    getAllowanceTx.moveCall({
      target: `${this.stablecoinPackageId}::treasury::mint_allowance`,
      typeArguments: [this.coinOtwType],
      arguments: [
        getAllowanceTx.object(this.treasuryObjectId),
        getAllowanceTx.pure.id(mintCapId)
      ]
    });
    const [allowance] = await callViewFunction({
      client: this.suiClient,
      transaction: getAllowanceTx,
      returnTypes: [bcs.U64]
    });
    return Number(allowance);
  }

  async getMintCapId(controllerAddress: string): Promise<string | null | undefined> {
    const getControllerTx = new Transaction();
    getControllerTx.moveCall({
      target: `${this.stablecoinPackageId}::treasury::get_mint_cap_id`,
      typeArguments: [this.coinOtwType],
      arguments: [
        getControllerTx.object(this.treasuryObjectId),
        getControllerTx.pure.address(controllerAddress)
      ]
    });
    const [controllerMintCapId] = await callViewFunction({
      client: this.suiClient,
      transaction: getControllerTx,
      returnTypes: [bcs.option(bcs.Address)]
    });
    return controllerMintCapId;
  }

  async getRoles() {
    const treasury = await this.suiClient.getObject({
      id: this.treasuryObjectId,
      options: {
        showContent: true
      }
    });
    if (treasury.data?.content?.dataType !== "moveObject") {
      throw new Error(
        `Expected 'moveObject', got '${treasury.data?.content?.dataType}'`
      );
    }

    const treasuryFields = treasury.data.content.fields as any;
    const roleFields = treasuryFields.roles.fields;
    const bagId = roleFields.data.fields.id.id;

    const getBagObjectFields = async (keyType: string) => {
      let dfo = await this.suiClient.getDynamicFieldObject({
        parentId: bagId,
        name: {
          type: keyType,
          value: { dummy_field: false }
        }
      });
      if (dfo.data?.content?.dataType !== "moveObject") {
        throw new Error(
          `Expected 'moveObject', got '${dfo.data?.content?.dataType}'`
        );
      }
      return dfo.data.content.fields as any;
    };

    const ownerFields = await getBagObjectFields(
      `${this.stablecoinPackageId}::roles::OwnerKey`
    );
    const masterMinterFields = await getBagObjectFields(
      `${this.stablecoinPackageId}::roles::MasterMinterKey`
    );
    const blocklisterFields = await getBagObjectFields(
      `${this.stablecoinPackageId}::roles::BlocklisterKey`
    );
    const pauserFields = await getBagObjectFields(
      `${this.stablecoinPackageId}::roles::PauserKey`
    );
    const metadataUpdaterFields = await getBagObjectFields(
      `${this.stablecoinPackageId}::roles::MetadataUpdaterKey`
    );
    return {
      owner: ownerFields.value.fields.active_address,
      pendingOwner: ownerFields.value.fields.pending_address,
      masterMinter: masterMinterFields.value,
      blocklister: blocklisterFields.value,
      pauser: pauserFields.value,
      metadataUpdater: metadataUpdaterFields.value
    };
  }

  parseMintCapId(txOutput: SuiTransactionBlockResponse) {
    const mintCapType = `${this.stablecoinPackageId}::treasury::MintCap<${this.coinOtwType}>`;
    const createdMintCap = getCreatedObjects(txOutput, mintCapType);
    if (createdMintCap.length != 1) {
      throw new Error(
        `Expected only one UpgradeCap to be created, got ${createdMintCap.length}`
      );
    }
    const mintCapId = createdMintCap[0].objectId;
    if (!mintCapId) {
      throw new Error("Could not find mint cap id");
    }
    return mintCapId;
  }
}
