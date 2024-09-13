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
import { strict as assert } from "assert";
import { program } from "commander";
import * as fs from "fs";
import _ from "lodash";
import * as yup from "yup";
import {
  SuiTreasuryClient,
  log,
  getEventsByType,
  getTableContent,
  yupSuiAddress,
  yupSuiAddressOrEmpty
} from "./helpers";

const configSchema = yup.object().shape({
  treasuryObjectId: yupSuiAddress().required(),
  expectedStates: yup.object().shape({
    stablecoinPackageId: yupSuiAddress().required(),
    coinType: yup.string().required(),
    controllers: yup.lazy((rawControllers) =>
      yup.object(
        _.mapValues(rawControllers, () =>
          yup.object().shape({
            mintCapId: yupSuiAddress().required()
          })
        )
      )
    ),
    mintAllowances: yup.lazy((mintAllowances) =>
      yup.object(
        _.mapValues(mintAllowances, () =>
          yup.object().shape({
            minter: yupSuiAddress().required(),
            allowance: yup.string().required()
          })
        )
      )
    ),
    roles: yup.object().required().shape({
      owner: yupSuiAddress().required(),
      pendingOwner: yupSuiAddressOrEmpty(),
      masterMinter: yupSuiAddress().required(),
      blocklister: yupSuiAddress().required(),
      pauser: yupSuiAddress().required(),
      metadataUpdater: yupSuiAddress().required()
    }),
    totalSupply: yup.string().required(),
    pauseState: yup.object().required().shape({
      current: yup.string().required(),
      next: yup.string().required()
    }),
    metadata: yup.object().required().shape({
      id: yup.string().required(),
      decimals: yup.string().required(),
      name: yup.string().required(),
      symbol: yup.string().required(),
      description: yup.string().required(),
      iconUrl: yup.string().url().required()
    }),
    compatibleVersions: yup.array().of(yup.string().required()).required(),
    blocklist: yup.array().of(yupSuiAddress().required()).required()
  })
});

export type ConfigFile = yup.InferType<typeof configSchema>;
export type TreasuryStates = ConfigFile["expectedStates"];

export async function validateTreasuryStatesHelper(
  treasuryClient: SuiTreasuryClient,
  expectedTreasuryState: TreasuryStates
) {
  const treasuryFields = await treasuryClient.getTreasuryObjectFields();
  const metadata = await treasuryClient.getMetadata();
  const actualRoles = await treasuryClient.getRoles();

  const actualTreasuryState: TreasuryStates = {
    stablecoinPackageId: treasuryClient.stablecoinPackageId,
    coinType: treasuryClient.coinOtwType,
    controllers: await constructControllersHelper(
      treasuryClient,
      treasuryFields.controllers.fields.id.id
    ),
    mintAllowances: await constructMintAllowancesHelper(
      treasuryClient,
      treasuryFields.mint_allowances.fields.id.id
    ),
    roles: {
      owner: actualRoles.owner,
      pendingOwner: actualRoles.pendingOwner ?? "",
      masterMinter: actualRoles.masterMinter,
      blocklister: actualRoles.blocklister,
      pauser: actualRoles.pauser,
      metadataUpdater: actualRoles.metadataUpdater
    },
    totalSupply: (await treasuryClient.getTotalSupply()).toString(),
    pauseState: {
      current: (await treasuryClient.isPaused("current")).toString(),
      next: (await treasuryClient.isPaused("next")).toString()
    },
    metadata: {
      id: metadata.id!,
      decimals: metadata.decimals.toString(),
      name: metadata.name,
      symbol: metadata.symbol,
      description: metadata.description,
      iconUrl: metadata.iconUrl ?? ""
    },
    compatibleVersions: await treasuryClient.getCompatibleVersions(),
    blocklist: await constructBlocklistHelper(treasuryClient)
  };

  // Assert that the actual treasury state matches the expected treasury state
  assert.deepStrictEqual(
    {
      ...actualTreasuryState,
      blocklist: new Set<string>(actualTreasuryState.blocklist)
    },
    {
      ...expectedTreasuryState,
      blocklist: new Set<string>(expectedTreasuryState.blocklist)
    }
  );

  // --- Additional Validations ---
  // Check mint cap object type
  for (const actualMintCapId of Object.keys(
    actualTreasuryState.mintAllowances
  )) {
    const mintCapObject = await treasuryClient.suiClient.getObject({
      id: actualMintCapId,
      options: {
        showType: true
      }
    });
    const mintCapObjectType = mintCapObject.data?.type;
    assert.equal(
      mintCapObjectType,
      `${treasuryClient.stablecoinPackageId}::treasury::MintCap<${treasuryClient.coinOtwType}>`
    );
  }

  // Check metadata object type
  const coinMetadata = await treasuryClient.suiClient.getObject({
    id: actualTreasuryState.metadata.id,
    options: {
      showContent: true,
      showType: true
    }
  });
  const actualCoinMetadataType = coinMetadata.data?.type;
  if (!actualCoinMetadataType) {
    throw new Error("Can't find coin metadata type");
  }
  assert.equal(
    actualCoinMetadataType,
    `0x2::coin::CoinMetadata<${treasuryClient.coinOtwType}>`
  );

  log("Verify Treasury States Done");
}

async function constructControllersHelper(
  treasuryClient: SuiTreasuryClient,
  controllersTableId: string
) {
  const controllers: TreasuryStates["controllers"] = {};

  const actualControllersTable = await getTableContent(
    treasuryClient.suiClient,
    controllersTableId
  );
  for (const dfo of actualControllersTable) {
    const actualControllerAddress = dfo.name.value as string;
    const actualMintCap = await treasuryClient.getMintCapId(
      actualControllerAddress
    );

    controllers[actualControllerAddress] = {
      mintCapId: actualMintCap!
    };
  }

  return controllers;
}

async function constructMintAllowancesHelper(
  treasuryClient: SuiTreasuryClient,
  mintAllowancesTableId: string
) {
  const mintAllowances: TreasuryStates["mintAllowances"] = {};

  const mintAllowancesTable = await getTableContent(
    treasuryClient.suiClient,
    mintAllowancesTableId
  );
  for (const dfo of mintAllowancesTable) {
    const actualMintCapId = dfo.name.value as string;

    const actualAllowance =
      await treasuryClient.getMintAllowance(actualMintCapId);
    const actualMinter = await treasuryClient.getObjectOwner(actualMintCapId);

    mintAllowances[actualMintCapId] = {
      allowance: actualAllowance.toString(),
      minter: actualMinter.address!
    };
  }

  return mintAllowances;
}

async function constructBlocklistHelper(
  treasuryClient: SuiTreasuryClient
): Promise<string[]> {
  const blocklist: TreasuryStates["blocklist"] = [];

  // Go through the history of Blocklisted events to construct the blocklist
  const blocklistedEvents = await getEventsByType(
    treasuryClient.suiClient,
    treasuryClient.stablecoinPackageId,
    treasuryClient.coinOtwType,
    "Blocklisted"
  );

  const maybeBlocklistedAccounts = blocklistedEvents.map((event) => {
    const eventData = event.parsedJson as { address: string };
    return eventData.address;
  });

  for (const address of maybeBlocklistedAccounts) {
    // Add only the ones that are blocked to the actual blocklist
    if (await treasuryClient.isBlocklisted(address, "next")) {
      blocklist.push(address);
    }
  }

  return blocklist;
}

export default program
  .createCommand("validate-treasury-states")
  .description("Validates all treasury states match the expected input")
  .argument("<string>", "Path to a validateTreasuryStates config file")
  .requiredOption(
    "-r, --rpc-url <string>",
    "Network RPC URL",
    process.env.RPC_URL
  )
  .action(async (configFile, options) => {
    const client = new SuiClient({ url: options.rpcUrl });

    const config: ConfigFile = JSON.parse(fs.readFileSync(configFile, "utf-8"));
    await configSchema.validate(config, {
      abortEarly: false,
      strict: true
    });

    const treasuryClient = await SuiTreasuryClient.buildFromId(
      client,
      config.treasuryObjectId
    );

    await validateTreasuryStatesHelper(treasuryClient, config.expectedStates);
  });
