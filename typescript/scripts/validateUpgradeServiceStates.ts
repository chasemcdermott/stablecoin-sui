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
import { log, yupSuiAddress, yupSuiAddressOrEmpty } from "./helpers";
import UpgradeServiceClient from "./helpers/upgradeServiceClient";

const upgradeServiceStatesSchema = yup.object().shape({
  suiExtensionsPackageId: yupSuiAddress().required(),
  upgradeServiceOtwType: yup.string().required(),
  admin: yupSuiAddress().required(),
  pendingAdmin: yupSuiAddressOrEmpty().required(),
  upgradeCapPackageId: yupSuiAddress().required(),
  upgradeCapVersion: yup.string().required(),
  upgradeCapPolicy: yup.number().required()
});

export type UpgradeServiceStates = yup.InferType<
  typeof upgradeServiceStatesSchema
>;

export async function validateUpgradeServiceStates(
  client: UpgradeServiceClient,
  expectedStates: UpgradeServiceStates
) {
  const actualStates: UpgradeServiceStates = {
    suiExtensionsPackageId: client.suiExtensionsPackageId,
    upgradeServiceOtwType: client.upgradeServiceOtwType,
    admin: await client.getAdmin(),
    pendingAdmin: (await client.getPendingAdmin()) || "",
    upgradeCapPackageId: await client.getUpgradeCapPackageId(),
    upgradeCapVersion: await client.getUpgradeCapVersion(),
    upgradeCapPolicy: await client.getUpgradeCapPolicy()
  };

  assert.deepStrictEqual(actualStates, expectedStates);

  log("Verify Upgrade Service States Done");
}

export default program
  .createCommand("validate-upgrade-service-states")
  .description("Validates all upgrade service states match the expected input")
  .requiredOption(
    "--upgrade-service-object-id <string>",
    "The ID of the upgrade service object"
  )
  .requiredOption(
    "--expected-states-file <string>",
    "Path to a file containing the controllers and relevant information in JSON format"
  )
  .requiredOption(
    "-r, --rpc-url <string>",
    "Network RPC URL",
    process.env.RPC_URL
  )
  .action(async (options) => {
    const client = new SuiClient({ url: options.rpcUrl });

    const upgradeServiceClient = await UpgradeServiceClient.buildFromId(
      client,
      options.upgradeServiceObjectId
    );

    // parse the data here
    const rawData = fs.readFileSync(options.expectedStatesFile, "utf-8");
    const expectedStates: UpgradeServiceStates = JSON.parse(rawData);

    await upgradeServiceStatesSchema.validate(expectedStates, {
      abortEarly: false,
      strict: true
    });
    await validateUpgradeServiceStates(upgradeServiceClient, expectedStates);
  });
