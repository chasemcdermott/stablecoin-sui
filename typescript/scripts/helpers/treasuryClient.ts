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
import { SuiClient, SuiTransactionBlockResponse } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import {
  getCreatedObjects,
  executeTransactionHelper,
  DENY_LIST_OBJECT_ID,
  callViewFunction
} from ".";

export const MIGRATION_ACTIONS = ["start", "complete", "abort"];

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
    const treasuryObjects = getCreatedObjects(deploymentTxOutput, {
      objectType: /(?<=treasury::Treasury<)\w{66}::\w*::\w*(?=>)/
    });
    if (treasuryObjects.length !== 1) {
      throw new Error("Expected to have one treasury object in the tx output");
    }
    const treasuryObjectId = treasuryObjects[0].objectId;
    const treasuryType = treasuryObjects[0].objectType;

    const metadataIds = getCreatedObjects(deploymentTxOutput, {
      objectType: /(?<=coin::CoinMetadata<)\w{66}::\w*::\w*(?=>)/
    });
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

  async configureNewController<DryRunEnabled extends boolean = false>(
    masterMinter: Ed25519Keypair,
    controllerAddress: string,
    minterAddress: string,
    options: {
      gasBudget: bigint | null;
      dryRun?: DryRunEnabled;
    }
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
      dryRun: !!options.dryRun as DryRunEnabled,
      client: this.suiClient,
      signer: masterMinter,
      transaction: txb,
      gasBudget: options?.gasBudget ?? null
    });
  }

  async setMintAllowance<DryRunEnabled extends boolean = false>(
    controller: Ed25519Keypair,
    mintAllowance: bigint,
    options: {
      gasBudget: bigint | null;
      dryRun?: DryRunEnabled;
    }
  ) {
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
      dryRun: !!options.dryRun as DryRunEnabled,
      client: this.suiClient,
      signer: controller,
      transaction: txb,
      gasBudget: options?.gasBudget ?? null
    });
  }

  async mint<DryRunEnabled extends boolean = false>(
    minter: Ed25519Keypair,
    mintCapId: string,
    recipient: string,
    amount: bigint,
    options: {
      gasBudget: bigint | null;
      dryRun?: DryRunEnabled;
    }
  ) {
    const txb = new Transaction();
    txb.moveCall({
      target: `${this.stablecoinPackageId}::treasury::mint`,
      typeArguments: [this.coinOtwType],
      arguments: [
        txb.object(this.treasuryObjectId),
        txb.object(mintCapId),
        txb.object(DENY_LIST_OBJECT_ID),
        txb.pure.u64(amount),
        txb.object(recipient)
      ]
    });
    return executeTransactionHelper({
      dryRun: !!options.dryRun as DryRunEnabled,
      client: this.suiClient,
      signer: minter,
      transaction: txb,
      gasBudget: options?.gasBudget ?? null
    });
  }

  async setBlocklistState<DryRunEnabled extends boolean = false>(
    blocklisterKeys: Ed25519Keypair,
    addr: string,
    blocked: boolean,
    options: {
      gasBudget: bigint | null;
      dryRun?: DryRunEnabled;
    }
  ) {
    const txb = new Transaction();
    const target = blocked
      ? `${this.stablecoinPackageId}::treasury::blocklist`
      : `${this.stablecoinPackageId}::treasury::unblocklist`;
    txb.moveCall({
      target,
      typeArguments: [this.coinOtwType],
      arguments: [
        txb.object(this.treasuryObjectId),
        txb.object(DENY_LIST_OBJECT_ID),
        txb.object(addr)
      ]
    });
    return executeTransactionHelper({
      dryRun: !!options.dryRun as DryRunEnabled,
      client: this.suiClient,
      signer: blocklisterKeys,
      transaction: txb,
      gasBudget: options?.gasBudget ?? null
    });
  }

  async setPausedState<DryRunEnabled extends boolean = false>(
    pauserKeys: Ed25519Keypair,
    paused: boolean,
    options: {
      gasBudget: bigint | null;
      dryRun?: DryRunEnabled;
    }
  ) {
    const txb = new Transaction();
    const target = paused
      ? `${this.stablecoinPackageId}::treasury::pause`
      : `${this.stablecoinPackageId}::treasury::unpause`;
    txb.moveCall({
      target,
      typeArguments: [this.coinOtwType],
      arguments: [
        txb.object(this.treasuryObjectId),
        txb.object(DENY_LIST_OBJECT_ID)
      ]
    });
    return executeTransactionHelper({
      dryRun: !!options.dryRun as DryRunEnabled,
      client: this.suiClient,
      signer: pauserKeys,
      transaction: txb,
      gasBudget: options?.gasBudget ?? null
    });
  }

  async isPaused(epochType: "current" | "next"): Promise<boolean> {
    const txb = new Transaction();
    txb.moveCall({
      target: `0x2::coin::deny_list_v2_is_global_pause_enabled_${epochType}_epoch`,
      typeArguments: [this.coinOtwType],
      arguments: [txb.object(DENY_LIST_OBJECT_ID)]
    });

    const [isPaused] = await callViewFunction({
      client: this.suiClient,
      transaction: txb,
      returnTypes: [bcs.Bool]
    });

    return isPaused;
  }

  async isBlocklisted(
    addr: string,
    epochType: "current" | "next"
  ): Promise<boolean> {
    const txb = new Transaction();
    txb.moveCall({
      target: `0x2::coin::deny_list_v2_contains_${epochType}_epoch`,
      typeArguments: [this.coinOtwType],
      arguments: [txb.object(DENY_LIST_OBJECT_ID), txb.object(addr)]
    });

    const [isBlocklisted] = await callViewFunction({
      client: this.suiClient,
      transaction: txb,
      returnTypes: [bcs.Bool]
    });

    return isBlocklisted;
  }

  async rotateController<DryRunEnabled extends boolean = false>(
    masterMinter: Ed25519Keypair,
    newControllerAddress: string,
    oldControllerAddress: string,
    options: {
      gasBudget: bigint | null;
      dryRun?: DryRunEnabled;
    }
  ) {
    const mintCapId = await this.getMintCapId(oldControllerAddress);
    if (!mintCapId) {
      throw new Error(
        `Could not find Mint Cap for controller address ${oldControllerAddress}`
      );
    }

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
      dryRun: !!options.dryRun as DryRunEnabled,
      client: this.suiClient,
      signer: masterMinter,
      transaction: txb,
      gasBudget: options?.gasBudget ?? null
    });
  }

  async updateMetadata<DryRunEnabled extends boolean = false>(
    owner: Ed25519Keypair,
    name: string,
    symbol: string,
    desc: string,
    iconUrl: string,
    options: {
      gasBudget: bigint | null;
      dryRun?: DryRunEnabled;
    }
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
      dryRun: !!options.dryRun as DryRunEnabled,
      client: this.suiClient,
      signer: owner,
      transaction: txb,
      gasBudget: options?.gasBudget ?? null
    });
  }

  async getObjectOwner(objectId: string): Promise<{
    type: string;
    address: string | undefined;
  }> {
    const mintCap = await this.suiClient.getObject({
      id: objectId,
      options: {
        showOwner: true
      }
    });
    const owner = mintCap.data?.owner as any;

    let type = "unknown";
    let address = undefined;
    if (!owner) {
      // continue
    } else if (owner === "Immutable") {
      type = "immutable";
    } else if (owner.AddressOwner) {
      type = "address";
      address = owner.AddressOwner;
    } else if (owner.ObjectOwner) {
      type = "object";
      address = owner.ObjectOwner;
    } else if (owner.Shared) {
      type = "shared";
    }

    return {
      type: type,
      address: address
    };
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
    return BigInt(allowance);
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
      const dfo = await this.suiClient.getDynamicFieldObject({
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

  async getTreasuryObjectFields() {
    const treasuryObject = await this.suiClient.getObject({
      id: this.treasuryObjectId,
      options: {
        showContent: true
      }
    });
    if (treasuryObject.data?.content?.dataType !== "moveObject") {
      throw new Error(
        `Expected 'moveObject', got '${treasuryObject.data?.content?.dataType}'`
      );
    }

    const treasuryFields = treasuryObject.data.content.fields as any;
    return treasuryFields;
  }

  async getTotalSupply() {
    const totalSupplyObject = await this.suiClient.getTotalSupply({
      coinType: this.coinOtwType
    });
    return BigInt(totalSupplyObject.value);
  }

  async rotatePrivilegedRoles<DryRunEnabled extends boolean = false>(
    owner: Ed25519Keypair,
    newMasterMinter: string,
    newBlockLister: string,
    newPauser: string,
    newMetadataUpdater: string,
    newTreasuryOwner: string,
    options: {
      gasBudget: bigint | null;
      dryRun?: DryRunEnabled;
    }
  ) {
    const rotatePrivilegedRolesTx = new Transaction();

    // update master minter
    rotatePrivilegedRolesTx.moveCall({
      target: `${this.stablecoinPackageId}::entry::update_master_minter`,
      typeArguments: [this.coinOtwType],
      arguments: [
        rotatePrivilegedRolesTx.object(this.treasuryObjectId),
        rotatePrivilegedRolesTx.pure.address(newMasterMinter)
      ]
    });

    // update blocklister
    rotatePrivilegedRolesTx.moveCall({
      target: `${this.stablecoinPackageId}::entry::update_blocklister`,
      typeArguments: [this.coinOtwType],
      arguments: [
        rotatePrivilegedRolesTx.object(this.treasuryObjectId),
        rotatePrivilegedRolesTx.pure.address(newBlockLister)
      ]
    });

    // update pauser
    rotatePrivilegedRolesTx.moveCall({
      target: `${this.stablecoinPackageId}::entry::update_pauser`,
      typeArguments: [this.coinOtwType],
      arguments: [
        rotatePrivilegedRolesTx.object(this.treasuryObjectId),
        rotatePrivilegedRolesTx.pure.address(newPauser)
      ]
    });

    // update metadata updater
    rotatePrivilegedRolesTx.moveCall({
      target: `${this.stablecoinPackageId}::entry::update_metadata_updater`,
      typeArguments: [this.coinOtwType],
      arguments: [
        rotatePrivilegedRolesTx.object(this.treasuryObjectId),
        rotatePrivilegedRolesTx.pure.address(newMetadataUpdater)
      ]
    });

    // initiate ownership transfer
    rotatePrivilegedRolesTx.moveCall({
      target: `${this.stablecoinPackageId}::entry::transfer_ownership`,
      typeArguments: [this.coinOtwType],
      arguments: [
        rotatePrivilegedRolesTx.object(this.treasuryObjectId),
        rotatePrivilegedRolesTx.pure.address(newTreasuryOwner)
      ]
    });

    return executeTransactionHelper({
      dryRun: !!options.dryRun as DryRunEnabled,
      client: this.suiClient,
      signer: owner,
      transaction: rotatePrivilegedRolesTx,
      gasBudget: options?.gasBudget ?? null
    });
  }

  async getCompatibleVersions() {
    const getCurrentVersionTx = new Transaction();
    getCurrentVersionTx.moveCall({
      target: `${this.stablecoinPackageId}::treasury::compatible_versions`,
      typeArguments: [this.coinOtwType],
      arguments: [getCurrentVersionTx.object(this.treasuryObjectId)]
    });
    const [compatibleVersions] = await callViewFunction({
      client: this.suiClient,
      transaction: getCurrentVersionTx,
      returnTypes: [bcs.vector(bcs.U64)]
    });
    return compatibleVersions;
  }

  async acceptTreasuryOwner<DryRunEnabled extends boolean = false>(
    pendingOwner: Ed25519Keypair,
    options: {
      gasBudget: bigint | null;
      dryRun?: DryRunEnabled;
    }
  ) {
    const acceptTreasuryOwnerTx = new Transaction();

    acceptTreasuryOwnerTx.moveCall({
      target: `${this.stablecoinPackageId}::entry::accept_ownership`,
      typeArguments: [this.coinOtwType],
      arguments: [acceptTreasuryOwnerTx.object(this.treasuryObjectId)]
    });

    return executeTransactionHelper({
      dryRun: !!options.dryRun as DryRunEnabled,
      client: this.suiClient,
      signer: pendingOwner,
      transaction: acceptTreasuryOwnerTx,
      gasBudget: options?.gasBudget ?? null
    });
  }

  async upgradeMigration<DryRunEnabled extends boolean = false>(
    owner: Ed25519Keypair,
    newPackageId: string, // TODO, refactor treasury client to be smarter about packageIDs
    migrationAction: string,
    options: {
      gasBudget: bigint | null;
      dryRun?: DryRunEnabled;
    }
  ) {
    const migrationTx = new Transaction();

    if (!MIGRATION_ACTIONS.includes(migrationAction)) {
      throw new Error(
        `Migration action must be one of ${MIGRATION_ACTIONS}, got ${migrationAction}`
      );
    }

    migrationTx.moveCall({
      target: `${newPackageId}::treasury::${migrationAction}_migration`,
      typeArguments: [this.coinOtwType],
      arguments: [migrationTx.object(this.treasuryObjectId)]
    });

    return executeTransactionHelper({
      dryRun: !!options.dryRun as DryRunEnabled,
      client: this.suiClient,
      signer: owner,
      transaction: migrationTx,
      gasBudget: options?.gasBudget ?? null
    });
  }
}