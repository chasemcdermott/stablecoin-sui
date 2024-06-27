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

import { getFaucetHost, requestSuiFromFaucetV0 } from "@mysten/sui/faucet";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { program } from "commander";

/**
 * Generates a signer, with the option to prefund with some test SUI from a faucet.
 *
 * @param fundSigner whether the generated address should be prefunded with test SUI
 * @param faucetUrl the faucet URL where test SUI should be requested from - default to localnet faucet host
 *
 * @returns Ed25519Keypair keypair
 */
export async function generateKeypair(
  fundSigner: boolean = false,
  faucetUrl: string | undefined = undefined
): Promise<Ed25519Keypair> {
  const keypair = Ed25519Keypair.generate();

  if (fundSigner) {
    console.log("Requesting test tokens...");
    await requestSuiFromFaucetV0({
      host: faucetUrl || getFaucetHost("localnet"),
      recipient: keypair.toSuiAddress()
    });
    console.log(`Funded address ${keypair.toSuiAddress()}`);
  }

  return keypair;
}

program
  .name("generate_signer")
  .description("Generate a new Sui keypair")
  .option("--prefund", "Fund generated signer with some test SUI tokens")
  .option("--faucet-url", "Faucet URL", process.env.FAUCET_URL)
  .action(async (options) => {
    const keypair = await generateKeypair(options.prefund, options.faucetUrl);
    console.log("Public key: ", keypair?.getPublicKey().toSuiAddress());
    console.log("Secret key: ", keypair?.getSecretKey());
  });

if (process.env.NODE_ENV !== "TESTING") {
  program.parse();
}
