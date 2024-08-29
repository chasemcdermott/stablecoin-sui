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
import { deployCommand } from "../../scripts/deploy";
import { generateKeypairCommand } from "../../scripts/generateKeypair";
import { Ed25519Keypair } from "@mysten/sui/dist/cjs/keypairs/ed25519";
import {
  expectError,
  DEFAULT_GAS_BUDGET,
  SuiTreasuryClient
} from "../../scripts/helpers";
import { configureMinterHelper } from "../../scripts/configureMinter";
import {
  TreasuryStates,
  validateTreasuryStatesHelper
} from "../../scripts/validateTreasuryStates";
import { setBlocklistStateHelper } from "../../scripts/setBlocklistState";

describe("Test validate treasury states script", () => {
  const RPC_URL: string = process.env.RPC_URL as string;
  const client = new SuiClient({ url: RPC_URL });
  let treasuryClient: SuiTreasuryClient;

  let deployerKeys: Ed25519Keypair;
  let upgraderKeys: Ed25519Keypair;
  let finalControllerKeys: Ed25519Keypair;
  let expectedTreasuryStates: TreasuryStates;

  before("Deploy USDC and Stablecoin Package", async () => {
    deployerKeys = await generateKeypairCommand({ prefund: true });
    upgraderKeys = await generateKeypairCommand({ prefund: false });

    const deployTxOutput = await deployCommand("usdc", {
      rpcUrl: RPC_URL,
      deployerKey: deployerKeys.getSecretKey(),
      upgradeCapRecipient: upgraderKeys.toSuiAddress(),
      withUnpublishedDependencies: true,
      gasBudget: DEFAULT_GAS_BUDGET.toString()
    });

    // build a client from the usdc deploy transaction output
    treasuryClient = SuiTreasuryClient.buildFromDeployment(
      client,
      deployTxOutput
    );

    finalControllerKeys = await generateKeypairCommand({ prefund: true });
    const finalControllerAddress = finalControllerKeys.toSuiAddress();
    const minterKeys = await generateKeypairCommand({ prefund: false });
    const mintCapId = await configureMinterHelper(treasuryClient, {
      hotMasterMinterKey: deployerKeys.getSecretKey(),
      tempControllerKey: deployerKeys.getSecretKey(),
      minterAddress: minterKeys.toSuiAddress(),
      mintAllowanceInDollars: BigInt(18446744073709),
      finalControllerAddress,
      gasBudget: DEFAULT_GAS_BUDGET.toString()
    });

    if (!mintCapId) {
      throw new Error("Configure Minter Failed");
    }

    const metadataId = (await treasuryClient.getMetadata()).id;
    if (!metadataId) {
      throw new Error("Can't find metadata id");
    }

    const blockedAddress = (
      await generateKeypairCommand({ prefund: false })
    ).toSuiAddress();
    await setBlocklistStateHelper(treasuryClient, blockedAddress, {
      blocklisterKey: deployerKeys.getSecretKey(),
      unblock: false,
      gasBudget: DEFAULT_GAS_BUDGET.toString()
    });

    const anotherBlockedAddress = (
      await generateKeypairCommand({ prefund: false })
    ).toSuiAddress();
    await setBlocklistStateHelper(treasuryClient, anotherBlockedAddress, {
      blocklisterKey: deployerKeys.getSecretKey(),
      unblock: false,
      gasBudget: DEFAULT_GAS_BUDGET.toString()
    });

    expectedTreasuryStates = {
      // the following two can't be tested as expected values aren't determined
      stablecoinPackageId: treasuryClient.stablecoinPackageId,
      coinType: treasuryClient.coinOtwType,
      controllers: {
        [finalControllerAddress]: {
          mintCapId
        }
      },
      mintAllowances: {
        [mintCapId]: {
          minter: minterKeys.toSuiAddress(),
          allowance: "18446744073709000000"
        }
      },
      roles: {
        owner: deployerKeys.toSuiAddress(),
        pendingOwner: "",
        masterMinter: deployerKeys.toSuiAddress(),
        blocklister: deployerKeys.toSuiAddress(),
        pauser: deployerKeys.toSuiAddress(),
        metadataUpdater: deployerKeys.toSuiAddress()
      },
      totalSupply: "0",
      pauseState: {
        current: "false",
        next: "false"
      },
      metadata: {
        id: metadataId,
        decimals: "6",
        name: "USDC",
        symbol: "USDC",
        description:
          "USDC is a US dollar-backed stablecoin issued by Circle. USDC is designed to provide a faster, safer, and more efficient way to send, spend, and exchange money around the world.",
        iconUrl: "https://www.circle.com/hubfs/Brand/USDC/USDC_icon_32x32.png"
      },
      compatibleVersions: ["1"],
      blocklist: [blockedAddress, anotherBlockedAddress]
    };
  });

  it("fails when controller data is wrong", async () => {
    const expectedTreasuryStatesCpy: TreasuryStates = JSON.parse(
      JSON.stringify(expectedTreasuryStates)
    );
    expectedTreasuryStatesCpy.controllers = {
      [finalControllerKeys.toSuiAddress()]: {
        mintCapId: "0x123"
      }
    };
    await expectError(
      () =>
        testValidateTreasuryStates({
          treasuryClient,
          expectedTreasuryStates: expectedTreasuryStatesCpy
        }),
      /Expected values to be strictly deep-equal/
    );
  });

  it("fails when not all controllers are found in the treasury states", async () => {
    const expectedTreasuryStatesCpy: TreasuryStates = JSON.parse(
      JSON.stringify(expectedTreasuryStates)
    );
    expectedTreasuryStatesCpy.controllers = {
      [finalControllerKeys.toSuiAddress()]: {
        mintCapId:
          expectedTreasuryStates.controllers[finalControllerKeys.toSuiAddress()]
            .mintCapId
      },
      "0xabc": {
        mintCapId: "0x123"
      }
    };
    await expectError(
      () =>
        testValidateTreasuryStates({
          treasuryClient,
          expectedTreasuryStates: expectedTreasuryStatesCpy
        }),
      /Expected values to be strictly deep-equal/
    );
  });

  it("fails when mint cap data is wrong", async () => {
    const expectedTreasuryStatesCpy: TreasuryStates = JSON.parse(
      JSON.stringify(expectedTreasuryStates)
    );
    expectedTreasuryStatesCpy.mintAllowances = {
      [expectedTreasuryStates.controllers[finalControllerKeys.toSuiAddress()]
        .mintCapId]: {
        minter: "0xabc",
        allowance: "100"
      }
    };
    await expectError(
      () =>
        testValidateTreasuryStates({
          treasuryClient,
          expectedTreasuryStates: expectedTreasuryStatesCpy
        }),
      /Expected values to be strictly deep-equal/
    );
  });

  it("fails when privileged roles address isn't correct", async () => {
    const expectedTreasuryStatesCpy: TreasuryStates = JSON.parse(
      JSON.stringify(expectedTreasuryStates)
    );
    const randomKeys = await generateKeypairCommand({ prefund: false });
    expectedTreasuryStatesCpy.roles.owner = randomKeys.toSuiAddress();
    await expectError(
      () =>
        testValidateTreasuryStates({
          treasuryClient,
          expectedTreasuryStates: expectedTreasuryStatesCpy
        }),
      /Expected values to be strictly deep-equal/
    );
  });

  it("fails when total supply is wrong", async () => {
    const expectedTreasuryStatesCpy: TreasuryStates = JSON.parse(
      JSON.stringify(expectedTreasuryStates)
    );
    expectedTreasuryStatesCpy.totalSupply = "999";
    await expectError(
      () =>
        testValidateTreasuryStates({
          treasuryClient,
          expectedTreasuryStates: expectedTreasuryStatesCpy
        }),
      /Expected values to be strictly deep-equal/
    );
  });

  it("fails when pause state is wrong", async () => {
    const expectedTreasuryStatesCpy: TreasuryStates = JSON.parse(
      JSON.stringify(expectedTreasuryStates)
    );
    expectedTreasuryStatesCpy.pauseState = {
      current: "true",
      next: "true"
    };
    await expectError(
      () =>
        testValidateTreasuryStates({
          treasuryClient,
          expectedTreasuryStates: expectedTreasuryStatesCpy
        }),
      /Expected values to be strictly deep-equal/
    );
  });

  it("fails when metadata content is wrong", async () => {
    const expectedTreasuryStatesCpy: TreasuryStates = JSON.parse(
      JSON.stringify(expectedTreasuryStates)
    );
    expectedTreasuryStatesCpy.metadata.decimals = "7";
    await expectError(
      () =>
        testValidateTreasuryStates({
          treasuryClient,
          expectedTreasuryStates: expectedTreasuryStatesCpy
        }),
      /Expected values to be strictly deep-equal/
    );
  });

  it("fails when compatible versions list is wrong", async () => {
    const expectedTreasuryStatesCpy: TreasuryStates = JSON.parse(
      JSON.stringify(expectedTreasuryStates)
    );
    expectedTreasuryStatesCpy.compatibleVersions = ["1", "99"];
    await expectError(
      () =>
        testValidateTreasuryStates({
          treasuryClient,
          expectedTreasuryStates: expectedTreasuryStatesCpy
        }),
      /Expected values to be strictly deep-equal/
    );
  });

  it("fails when block list is wrong", async () => {
    const expectedTreasuryStatesCpy: TreasuryStates = JSON.parse(
      JSON.stringify(expectedTreasuryStates)
    );
    const randomAddress = (
      await generateKeypairCommand({ prefund: false })
    ).toSuiAddress();
    expectedTreasuryStatesCpy.blocklist.push(randomAddress);

    await expectError(
      () =>
        testValidateTreasuryStates({
          treasuryClient,
          expectedTreasuryStates: expectedTreasuryStatesCpy
        }),
      /Expected values to be strictly deep-equal/
    );
  });

  it("Successfully validates all treasury states when all states are as expected", async () => {
    await testValidateTreasuryStates({
      treasuryClient,
      expectedTreasuryStates
    });
  });
});

async function testValidateTreasuryStates(args: {
  treasuryClient: SuiTreasuryClient;
  expectedTreasuryStates: TreasuryStates;
}) {
  await validateTreasuryStatesHelper(
    args.treasuryClient,
    args.expectedTreasuryStates
  );
}
