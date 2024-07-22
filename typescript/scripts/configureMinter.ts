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

import { program } from "commander";
import {
  getEd25519KeypairFromPrivateKey,
  writeJsonOutput,
  log,
  waitForUserConfirmation,
  SuiTreasuryClient,
  readTransactionOutput
} from "./helpers";
import { SuiClient } from "@mysten/sui/client";

/**
 * Configures a new minter using a hot controller key.
 * After configuration, rotate the hot controller to a cold controller address.
 *
 * @returns Transaction output
 */
export async function configureMinterHelper(
  treasuryClient: SuiTreasuryClient,
  hotMasterMinterKey: string,
  hotControllerKey: string,
  minterAddress: string,
  mintAllowance: number,
  coldControllerAddress: string
): Promise<string | undefined> {
  const hotMasterMinter = getEd25519KeypairFromPrivateKey(hotMasterMinterKey);
  const hotController = getEd25519KeypairFromPrivateKey(hotControllerKey);

  // === STEP 0: VALIDATION ===

  // Ensure that the cold controller has not already been configured
  // Fail early so that we don't unintentionally create more hot controllers
  const coldControllerMintCapId = await treasuryClient.getMintCapId(
    coldControllerAddress
  );
  if (coldControllerMintCapId) {
    throw new Error(
      `Cold controller is already configured with MintCap ${coldControllerMintCapId}`
    );
  }

  // Ensure that the master minter key is correct
  const { masterMinter } = await treasuryClient.getRoles();
  if (masterMinter !== hotMasterMinter.toSuiAddress()) {
    throw new Error(
      `Incorrect master minter key, given ${hotMasterMinter.toSuiAddress()}, expected ${masterMinter}`
    );
  }

  // === STEP 1: HOT CONTROLLER CONFIGURATION ===

  // Check if hot controller/minter pair already exists. If so, continue to STEP 2.
  // If the hot controller key exists but the mint cap is not held by the expected minter,
  // fail early to avoid confusion around which minter is being configured.
  let skipConfigureNewController = false;
  let mintCapId = await treasuryClient.getMintCapId(
    hotController.toSuiAddress()
  );
  if (mintCapId) {
    const mintCapOwner = await treasuryClient.getMintCapOwner(mintCapId);
    if (mintCapOwner === minterAddress) {
      log(
        `The hot controller/minter pair (${hotController.toSuiAddress()}/${minterAddress}) already exists. Skipping hot controller configuration...`
      );
      skipConfigureNewController = true;
    } else {
      throw new Error(
        `Hot controller was already configured, but the MintCap ${mintCapId} is held by ${mintCapOwner}, not ${minterAddress}`
      );
    }
  }

  // Configure a hot controller and transfer the MintCap to the minter, using the hotMasterMinter
  if (!skipConfigureNewController) {
    log(
      `Going to create a new hot controller ${hotController.toSuiAddress()} and transfer its MintCap to ${minterAddress}`
    );
    if (!(await waitForUserConfirmation())) {
      throw new Error("Terminating...");
    }
    const txOutput = await treasuryClient.configureNewController(
      hotMasterMinter,
      hotController.toSuiAddress(),
      minterAddress
    );
    writeJsonOutput("configure-new-controller", txOutput);

    mintCapId = treasuryClient.parseMintCapId(txOutput);
    log(`Created new MintCap with ID ${mintCapId}`);
  }

  // The mintCapId should be set now
  if (!mintCapId) {
    throw new Error(
      "Expected the MintCap object to exist, but could not find it."
    );
  }

  // === STEP 2: MINT ALLOWANCE CONFIGURATION ===

  // Check if the mint allowance has already been set. If so, continue to STEP 3.
  let skipSetMintAllowance = false;
  const currentMintAllowance = await treasuryClient.getMintAllowance(mintCapId);
  if (currentMintAllowance == mintAllowance) {
    log(
      `The current mint allowance is already ${mintAllowance}. Skipping mint allowance configuration...`
    );
    skipSetMintAllowance = true;
  }

  // Set the mint allowance, using the configured hot controller
  if (!skipSetMintAllowance) {
    log(
      `Going to set the mint allowance to ${mintAllowance} for MintCap ${mintCapId} currently held by ${minterAddress}`
    );
    if (!(await waitForUserConfirmation())) {
      throw new Error("Terminating...");
    }
    const txOutput = await treasuryClient.setMintAllowance(
      hotController,
      mintAllowance
    );
    writeJsonOutput("set-mint-allowance", txOutput);
  }

  // === STEP 3: CONTROLLER KEY ROTATION ===

  // Rotate the controller to the cold controller address, using the hot master minter
  log(
    `Going to rotate the hot controller key from ${hotController.toSuiAddress()} to ${coldControllerAddress}}`
  );
  if (!(await waitForUserConfirmation())) {
    throw new Error("Terminating...");
  }
  const txOutput = await treasuryClient.rotateController(
    hotMasterMinter,
    coldControllerAddress,
    hotController.toSuiAddress(),
    mintCapId
  );
  writeJsonOutput("rotate-controller", txOutput);

  log("Mint configuration complete");

  return mintCapId;
}

export default program
  .createCommand("configure-minter")
  .description(
    "Configures a new minter using a hot controller key and rotates to a cold controller address"
  )
  .option(
    "--treasury-deploy-file <string>",
    "Path to a file containing the treasury deploy output in JSON format"
  )
  .option("--treasury-object-id <string>", "The ID of the treasury object")
  .requiredOption(
    "--hot-master-minter-key <string>",
    "The private key of the treasury object's master minter"
  )
  .requiredOption(
    "--hot-controller-key <string>",
    "The private key of a funded address to use as a temporary controller"
  )
  .requiredOption(
    "--minter-address <string>",
    "The address of the minter to be configured"
  )
  .requiredOption("--mint-allowance <number>", "The mint allowance to set")
  .requiredOption(
    "--cold-controller-address <string>",
    "The address that the final controller should be set to"
  )
  .option("-r, --rpc-url <string>", "Network RPC URL", process.env.RPC_URL)
  .action(async (options) => {
    const client = new SuiClient({ url: options.rpcUrl });

    if (!options.treasuryDeployFile && !options.treasuryObjectId) {
      throw new Error(
        "Must specify one of either treasury deploy file or object ID"
      );
    }
    if (options.treasuryDeployFile && options.treasuryObjectId) {
      throw new Error(
        "Both treasury deploy file and object ID were specified. Please choose one."
      );
    }

    let treasuryClient: SuiTreasuryClient;
    if (options.treasuryObjectId) {
      treasuryClient = await SuiTreasuryClient.buildFromId(
        client,
        options.treasuryObjectId
      );
    } else {
      const deploymentTxOutput = readTransactionOutput(
        options.treasuryDeployFile
      );
      treasuryClient = SuiTreasuryClient.buildFromDeployment(
        client,
        deploymentTxOutput
      );
    }

    configureMinterHelper(
      treasuryClient,
      options.hotMasterMinterKey,
      options.hotControllerKey,
      options.minterAddress,
      options.mintAllowance,
      options.coldControllerAddress
    );
  });
