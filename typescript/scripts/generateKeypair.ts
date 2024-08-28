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

import { getFaucetHost, requestSuiFromFaucetV0 } from "@mysten/sui/faucet";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { program } from "commander";
import { log, writeJsonOutput } from "./helpers";

/**
 * Generates a signer, with the option to prefund with some test SUI from a faucet.
 *
 * @param fundSigner whether the generated address should be prefunded with test SUI
 * @param faucetUrl the faucet URL where test SUI should be requested from - default to localnet faucet host
 *
 * @returns Ed25519Keypair keypair
 */
export async function generateKeypairCommand(options: {
  prefund?: boolean;
  faucetUrl?: string;
}): Promise<Ed25519Keypair> {
  const keypair = Ed25519Keypair.generate();

  if (options.prefund) {
    log("Requesting test tokens...");
    await requestSuiFromFaucetV0({
      host: options.faucetUrl || getFaucetHost("localnet"),
      recipient: keypair.toSuiAddress()
    });
    log(`Funded address ${keypair.toSuiAddress()}`);
  }

  writeJsonOutput("generate-keypair", {
    publicKey: keypair.getPublicKey().toSuiAddress(),
    secretKey: keypair.getSecretKey(),
    funded: options.prefund
  });

  return keypair;
}

export default program
  .createCommand("generate-keypair")
  .description("Generate a new Sui keypair")
  .option("--prefund", "Fund generated signer with some test SUI tokens")
  .option("--faucet-url", "Faucet URL", process.env.FAUCET_URL)
  .action(async (options) => {
    const keypair = await generateKeypairCommand(options);
    log("Public key: ", keypair.getPublicKey().toSuiAddress());
    log("Secret key: ", keypair.getSecretKey());
  });
