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

import { bcs } from "@mysten/sui/bcs";
import { SuiClient, SuiTransactionBlockResponse } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import {
  getCreatedObjects,
  executeTransactionHelper,
  DENY_LIST_OBJECT_ID,
  callViewFunction
} from ".";

export default class SuiTreasuryClient {
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

  async getMintCapId(
    controllerAddress: string
  ): Promise<string | null | undefined> {
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

  async getMetadata() {
    const maybeMetadata = await this.suiClient.getCoinMetadata({
      coinType: this.coinOtwType
    });
    if (!maybeMetadata) {
      throw new Error(
        `Could not find metadata for coin with type ${this.coinOtwType}`
      );
    }
    return maybeMetadata;
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
        `Expected only one MintCap to be created, got ${createdMintCap.length}`
      );
    }
    const mintCapId = createdMintCap[0].objectId;
    if (!mintCapId) {
      throw new Error("Could not find mint cap id");
    }
    return mintCapId;
  }
}
