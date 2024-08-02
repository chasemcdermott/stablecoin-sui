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

import { SuiClient } from "@mysten/sui/client";
import { deployCommand } from "../../scripts/deploy";
import { generateKeypairCommand } from "../../scripts/generateKeypair";
import { Ed25519Keypair } from "@mysten/sui/dist/cjs/keypairs/ed25519";
import { privilegedRoleKeyRotationHelper } from "../../scripts/privilegedRoleKeyRotation";
import { expectError, SuiTreasuryClient } from "../../scripts/helpers";
import { strict as assert } from "assert";

describe("Test privileged key role rotation script", () => {
    const RPC_URL: string = process.env.RPC_URL as string;
    const client = new SuiClient({ url: RPC_URL });
    let treasuryClient: SuiTreasuryClient;

    let deployerKeys: Ed25519Keypair;
    let upgraderKeys: Ed25519Keypair;

    before("Deploy USDC and update privileged role keys", async () => {
        deployerKeys = await generateKeypairCommand({ prefund: true });
        upgraderKeys = await generateKeypairCommand({ prefund: false });
        const deployTxOutput = await deployCommand("usdc", {
            rpcUrl: RPC_URL,
            deployerKey: deployerKeys.getSecretKey(),
            upgradeCapRecipient: upgraderKeys.toSuiAddress(),
            withUnpublishedDependencies: true
        });
        
        // build a client from the usdc deploy transaction output
        treasuryClient = SuiTreasuryClient.buildFromDeployment(
            client,
            deployTxOutput
        );
    
        const newMasterMinterKey = await generateKeypairCommand({ prefund: true });
        const newBlocklisterKey = await generateKeypairCommand({ prefund: true });
        const newPauserKey = await generateKeypairCommand({ prefund: true });
        const newMetadataUpdaterKey = await generateKeypairCommand({ prefund: true });
        const newTreasuryOwnerKey = await generateKeypairCommand({ prefund: false });
        await testPriviledgedKeyRoleRotation({
            treasuryClient,
            treasuryOwner: deployerKeys,
            newMasterMinter: newMasterMinterKey,
            newBlocklister: newBlocklisterKey,
            newPauser: newPauserKey,
            newMetadataUpdater: newMetadataUpdaterKey,
            newTreasuryOwner: newTreasuryOwnerKey
        });
    });

    it("Fails when the owner is inconsistent with actual owner", async () => {
        const randomKeys = await generateKeypairCommand({ prefund: false });
        const newMasterMinterKey = await generateKeypairCommand({ prefund: true });
        const newBlocklisterKey = await generateKeypairCommand({ prefund: true });
        const newPauserKey = await generateKeypairCommand({ prefund: true });
        const newMetadataUpdaterKey = await generateKeypairCommand({ prefund: true });
        const newTreasuryOwnerKey = await generateKeypairCommand({ prefund: false });
        await expectError(
            () =>
                testPriviledgedKeyRoleRotation({
                    treasuryClient,
                    treasuryOwner: randomKeys,
                    newMasterMinter: newMasterMinterKey,
                    newBlocklister: newBlocklisterKey,
                    newPauser: newPauserKey,
                    newMetadataUpdater: newMetadataUpdaterKey,
                    newTreasuryOwner: newTreasuryOwnerKey
                }),
            "Received owner's private key doesn't match expected!"
          );
    });
});

async function testPriviledgedKeyRoleRotation(args: {
    treasuryClient: SuiTreasuryClient;
    treasuryOwner: Ed25519Keypair;
    newMasterMinter: Ed25519Keypair;
    newBlocklister: Ed25519Keypair;
    newPauser: Ed25519Keypair;
    newMetadataUpdater: Ed25519Keypair;
    newTreasuryOwner: Ed25519Keypair;
}) {
    await privilegedRoleKeyRotationHelper(args.treasuryClient, {
        treasuryOwnerKey: args.treasuryOwner.getSecretKey(),
        newMasterMinterKey: args.newMasterMinter.getSecretKey(),
        newBlocklisterKey: args.newBlocklister.getSecretKey(),
        newPauserKey: args.newPauser.getSecretKey(),
        newMetadataUpdaterKey: args.newMetadataUpdater.getSecretKey(),
        newTreasuryOwnerKey: args.newTreasuryOwner.getSecretKey()
    });

    const { masterMinter } = await args.treasuryClient.getRoles();
    const { blocklister } = await args.treasuryClient.getRoles();
    const { pauser } = await args.treasuryClient.getRoles();
    const { metadataUpdater } = await args.treasuryClient.getRoles();
    const { pendingOwner } = await args.treasuryClient.getRoles();

    assert.equal(masterMinter, args.newMasterMinter.toSuiAddress());
    assert.equal(blocklister, args.newBlocklister.toSuiAddress());
    assert.equal(pauser, args.newPauser.toSuiAddress());
    assert.equal(metadataUpdater, args.newMetadataUpdater.toSuiAddress());
    assert.equal(pendingOwner, args.newTreasuryOwner.toSuiAddress());
}