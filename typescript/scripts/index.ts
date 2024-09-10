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

import "dotenv/config";
import { program } from "commander";

import deploy from "./deploy";
import generateKeypair from "./generateKeypair";
import depositUpgradeCap from "./depositUpgradeCap";
import setBlocklistState from "./setBlocklistState";
import configureMinter from "./configureMinter";
import rotatePrivilegedRoles from "./rotatePrivilegedRoles";
import changeUpgradeServiceAdmin from "./changeUpgradeServiceAdmin";
import validateTreasuryStates from "./validateTreasuryStates";
import validateUpgradeServiceStates from "./validateUpgradeServiceStates";
import rotateController from "./rotateController";
import usdcDeploySummary from "./usdcDeploySummary";
import acceptTreasuryOwner from "./acceptTreasuryOwner";
import acceptUpgradeServiceAdmin from "./acceptUpgradeServiceAdmin";
import upgrade from "./upgrade";
import upgradeMigration from "./upgradeMigration";

program
  .name("scripts")
  .description("Scripts related to SUI development")
  .addCommand(configureMinter)
  .addCommand(deploy)
  .addCommand(generateKeypair)
  .addCommand(depositUpgradeCap)
  .addCommand(setBlocklistState)
  .addCommand(rotatePrivilegedRoles)
  .addCommand(changeUpgradeServiceAdmin)
  .addCommand(validateTreasuryStates)
  .addCommand(validateUpgradeServiceStates)
  .addCommand(rotateController)
  .addCommand(usdcDeploySummary)
  .addCommand(acceptTreasuryOwner)
  .addCommand(acceptUpgradeServiceAdmin)
  .addCommand(upgrade)
  .addCommand(upgradeMigration);

if (process.env.NODE_ENV !== "TESTING") {
  program.parse();
}
