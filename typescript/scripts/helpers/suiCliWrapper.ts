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

import path from "path";
import { parse } from "yaml";
import fs from "fs";
import { execSync } from "child_process";

/**
 * Wrapper around the sui CLI tool for use in scripts.
 * Maintains a config file that controls the environments that the CLI is connected to.
 */
export default class SuiCliWrapper {
  configPath: string;

  public constructor(options: { configPath?: string; rpcUrl?: string }) {
    this.configPath =
      options.configPath ||
      path.join(__dirname, "../../../.sui/sui_config/client.yaml");

    if (options.rpcUrl) {
      this.switchSuiRpc(options.rpcUrl);
    }
  }

  private switchSuiRpc(rpcUrl: string) {
    const file = fs.readFileSync(this.configPath, "utf8");
    const config = parse(file);
    const env = config.envs.find((env: any) => env.rpc === rpcUrl);
    if (!env) {
      throw new Error(
        `Could not find configured env with RPC ${rpcUrl}. Check config at ${this.configPath}`
      );
    }

    try {
      execSync(
        `sui client --client.config ${this.configPath} switch --env ${env.alias}`,
        { encoding: "utf-8" }
      );
    } catch (error) {
      console.log(JSON.stringify(error));
      throw error;
    }
  }

  public buildPackage(args: {
    packageName: string;
    withUnpublishedDependencies: boolean;
  }): {
    modules: string[];
    dependencies: string[];
    digest: number[];
  } {
    const packagePath = path.join(
      __dirname,
      `../../../packages/${args.packageName}`
    );
    const withUnpublishedDependenciesArg = args.withUnpublishedDependencies
      ? "--with-unpublished-dependencies"
      : "";

    try {
      // As of Sui v1.32.2, we need to fetch the sui client config because a config is required to use --dump-bytecode-as-base64.
      // The sui CLI uses this to fetch the chainId as a key to look up managed addresses (see https://docs.sui.io/concepts/sui-move-concepts/packages/automated-address-management).
      // If managed addresses are not being used at all, the command falls back to using the "published-at" fields in the Move.toml of dependent packages.
      // Because we don't use managed addresses yet, it should be safe to use a localnet config, even for testnet or mainnet environments.
      const rawCompiledPackages = execSync(
        `sui move --client.config ${this.configPath} build --dump-bytecode-as-base64 --path ${packagePath} ${withUnpublishedDependenciesArg} 2> /dev/null`,
        { encoding: "utf-8" }
      );
      return JSON.parse(rawCompiledPackages);
    } catch (error) {
      console.log(JSON.stringify(error));
      throw error;
    }
  }

  public writePublishedAddressToPackageManifest(
    packageName: string,
    address: string
  ) {
    const moveTomlFilepath = this.getMoveTomlFilepath(packageName);
    let existingContent = fs.readFileSync(moveTomlFilepath, "utf-8");

    // Add published-at field.
    existingContent = existingContent.replace(
      "[package]",
      `[package]\npublished-at = "${address}"`
    );

    // Set package alias to address.
    existingContent = existingContent.replace(
      `${packageName} = "0x0"`,
      `${packageName} = "${address}"`
    );

    fs.writeFileSync(moveTomlFilepath, existingContent);

    // Run a build to update the Move.lock file.
    this.buildPackage({ packageName, withUnpublishedDependencies: false });
  }

  public resetPublishedAddressInPackageManifest(packageName: string) {
    const moveTomlFilepath = this.getMoveTomlFilepath(packageName);
    let existingContent = fs.readFileSync(moveTomlFilepath, "utf-8");

    // Remove published-at field.
    existingContent = existingContent.replace(/\npublished-at.*\w{66}.*/, "");

    // Reset package alias to 0x0.
    existingContent = existingContent.replace(
      new RegExp(`\\n${packageName}.*\\w{66}.*`),
      `\n${packageName} = "0x0"`
    );

    fs.writeFileSync(moveTomlFilepath, existingContent);

    // Run a build to update the Move.lock file.
    this.buildPackage({ packageName, withUnpublishedDependencies: false });
  }

  private getMoveTomlFilepath(packageName: string) {
    return path.join(
      __dirname,
      "..",
      "..",
      "..",
      "packages",
      packageName,
      "Move.toml"
    );
  }
}
