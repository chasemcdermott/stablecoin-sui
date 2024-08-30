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
import { callViewFunction, executeTransactionHelper } from ".";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

export default class UpgradeServiceClient {
  suiClient: SuiClient;
  upgradeServiceObjectId: string;
  suiExtensionsPackageId: string;
  upgradeServiceOtwType: string;

  public constructor(
    suiClient: SuiClient,
    upgradeServiceObjectId: string,
    suiExtensionsPackageId: string,
    upgradeServiceOtwType: string
  ) {
    this.suiClient = suiClient;
    this.upgradeServiceObjectId = upgradeServiceObjectId;
    this.suiExtensionsPackageId = suiExtensionsPackageId;
    this.upgradeServiceOtwType = upgradeServiceOtwType;
  }

  public static async buildFromId(
    suiClient: SuiClient,
    upgradeServiceObjectId: string
  ) {
    const upgradeServiceObject = await suiClient.getObject({
      id: upgradeServiceObjectId,
      options: {
        showType: true
      }
    });
    if (!upgradeServiceObject.data?.type) {
      throw new Error("Failed to retrieve upgrade service object type");
    }
    const upgradeServiceType = upgradeServiceObject.data.type;

    return this.buildHelper(
      suiClient,
      upgradeServiceObjectId,
      upgradeServiceType
    );
  }

  private static buildHelper(
    suiClient: SuiClient,
    upgradeServiceObjectId: string,
    upgradeServiceType: string
  ) {
    const suiExtensionsPackageId = upgradeServiceType.split("::")[0];
    const upgradeServiceOtwType = upgradeServiceType.match(
      /(?<=upgrade_service::UpgradeService<)\w{66}::\w*::\w*(?=>)/
    )?.[0];
    if (!upgradeServiceOtwType) {
      throw new Error("Failed to parse upgrade service OTW type");
    }
    return new UpgradeServiceClient(
      suiClient,
      upgradeServiceObjectId,
      suiExtensionsPackageId,
      upgradeServiceOtwType
    );
  }

  public async depositUpgradeCap(
    upgradeCapOwner: Ed25519Keypair,
    upgradeCapObjectId: string,
    options: { gasBudget: bigint | null }
  ) {
    const transaction = new Transaction();
    transaction.moveCall({
      target: `${this.suiExtensionsPackageId}::upgrade_service::deposit`,
      typeArguments: [this.upgradeServiceOtwType],
      arguments: [
        transaction.object(this.upgradeServiceObjectId),
        transaction.object(upgradeCapObjectId)
      ]
    });

    return executeTransactionHelper({
      client: this.suiClient,
      signer: upgradeCapOwner,
      transaction,
      gasBudget: options.gasBudget != null ? BigInt(options.gasBudget) : null
    });
  }

  public async changeAdmin(
    admin: Ed25519Keypair,
    newAdmin: string,
    options: { gasBudget: bigint | null }
  ) {
    const changeUpgradeServiceAdminTx = new Transaction();
    changeUpgradeServiceAdminTx.moveCall({
      target: `${this.suiExtensionsPackageId}::upgrade_service::change_admin`,
      typeArguments: [this.upgradeServiceOtwType],
      arguments: [
        changeUpgradeServiceAdminTx.object(this.upgradeServiceObjectId),
        changeUpgradeServiceAdminTx.pure.address(newAdmin)
      ]
    });

    // Initiate change upgrade service admin roles
    return executeTransactionHelper({
      client: this.suiClient,
      signer: admin,
      transaction: changeUpgradeServiceAdminTx,
      gasBudget: options.gasBudget != null ? BigInt(options.gasBudget) : null
    });
  }

  public async getAdmin(): Promise<string> {
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.suiExtensionsPackageId}::upgrade_service::admin`,
      typeArguments: [this.upgradeServiceOtwType],
      arguments: [tx.object(this.upgradeServiceObjectId)]
    });
    const [adminAddress] = await callViewFunction({
      client: this.suiClient,
      transaction: tx,
      returnTypes: [bcs.Address]
    });
    return adminAddress;
  }

  public async getPendingAdmin(): Promise<string | null | undefined> {
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.suiExtensionsPackageId}::upgrade_service::pending_admin`,
      typeArguments: [this.upgradeServiceOtwType],
      arguments: [tx.object(this.upgradeServiceObjectId)]
    });
    const [pendingAdmin] = await callViewFunction({
      client: this.suiClient,
      transaction: tx,
      returnTypes: [bcs.option(bcs.Address)]
    });
    return pendingAdmin;
  }

  public async getUpgradeCapPackageId(): Promise<string> {
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.suiExtensionsPackageId}::upgrade_service::upgrade_cap_package`,
      typeArguments: [this.upgradeServiceOtwType],
      arguments: [tx.object(this.upgradeServiceObjectId)]
    });
    const [packageId] = await callViewFunction({
      client: this.suiClient,
      transaction: tx,
      returnTypes: [bcs.Address]
    });
    return packageId;
  }

  public async getUpgradeCapVersion(): Promise<string> {
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.suiExtensionsPackageId}::upgrade_service::upgrade_cap_version`,
      typeArguments: [this.upgradeServiceOtwType],
      arguments: [tx.object(this.upgradeServiceObjectId)]
    });
    const [version] = await callViewFunction({
      client: this.suiClient,
      transaction: tx,
      returnTypes: [bcs.U64]
    });
    return version;
  }

  public async getUpgradeCapPolicy(): Promise<number> {
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.suiExtensionsPackageId}::upgrade_service::upgrade_cap_policy`,
      typeArguments: [this.upgradeServiceOtwType],
      arguments: [tx.object(this.upgradeServiceObjectId)]
    });
    const [policy] = await callViewFunction({
      client: this.suiClient,
      transaction: tx,
      returnTypes: [bcs.U8]
    });
    return policy;
  }
}
