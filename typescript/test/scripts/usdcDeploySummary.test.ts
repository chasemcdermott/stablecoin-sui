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

import { SuiTransactionBlockResponse } from "@mysten/sui/client";
import { strict as assert } from "assert";
import { expectError, readTransactionOutput } from "../../scripts/helpers";
import { parseUsdcDeploy } from "../../scripts/usdcDeploySummary";

describe("Test set blocklist state script", () => {
  let suiExtensionsDeployOutput: SuiTransactionBlockResponse;
  let stablecoinDeployOutput: SuiTransactionBlockResponse;
  let usdcDeployOutput: SuiTransactionBlockResponse;
  let usdcDeployWithDependenciesOutput: SuiTransactionBlockResponse;

  before("Read USDC deploy transaction outputs", async () => {
    suiExtensionsDeployOutput = readTransactionOutput(
      "test/samples/deploy-sui_extensions-sample.json"
    );
    stablecoinDeployOutput = readTransactionOutput(
      "test/samples/deploy-stablecoin-sample.json"
    );
    usdcDeployOutput = readTransactionOutput(
      "test/samples/deploy-usdc-sample.json"
    );
    usdcDeployWithDependenciesOutput = readTransactionOutput(
      "test/samples/deploy-usdc-with-dependencies-sample.json"
    );
  });

  it("Successfully parses the relevant packageIds and objectIds", () => {
    const expected = {
      packageIds: {
        suiExtensions:
          "0x8753ef8c662dd9b2452405d433c7720e0b0f4732e1ddffc70b552fe206216742",
        stablecoin:
          "0x351d4809944868c286ae92bf9751acfca14fb018b153afa9d65039f69e5daadb",
        usdc: "0xb05f9eac869a14b32f9d64a29e3820ca070d7733f65a4aeb8c28a89df5d53f9a"
      },
      objectIds: {
        stablecoinUpgradeCap:
          "0x19233fe621785b0ecaba708f0ed59827492ca25baaba3f62a6cab6ba716f3eb0",
        stablecoinUpgradeService:
          "0x5b3af379e6a79e5f5d5f291cb309517766e807827ee2d4037045f8f59080a519",
        usdcUpgradeCap:
          "0xc956e37c865592e67a88246f103975e9e8f8a0a7d655109010bfd53e3d2f07a8",
        usdcUpgradeService:
          "0x889429c17889780fb7ffdbccabfc33be03ec91b33db119eabfee7db4841ced93",
        usdcTreasury:
          "0xe5e73261e49320d882ec93595ba4a8714f2e2def87242ccd501c7c91f6c6ed73",
        usdcTreasuryCap:
          "0xcfb7cb0c503b195bac3e61f47935e91d0f58e747f9db71416b683b508c77acb3",
        usdcDenyCapV2:
          "0x0edfee65e211a0f2c5d1b75e2f1f09e3378ce381ac355a0432e8fae47cf4a695",
        usdcCoinMetadata:
          "0x219fe069877d0771e292dc6bead4726e1a6d0c9be29970ddf9e4adb5dea258c9",
        usdcRegulatedCoinMetadata:
          "0x810659739ff4a5b89c18b8d7c2a930b00357abe6b546a069220b90e9176b3228"
      }
    };
    const actual = parseUsdcDeploy(
      suiExtensionsDeployOutput,
      stablecoinDeployOutput,
      usdcDeployOutput
    );
    assert.deepStrictEqual(actual, expected);
  });

  it("Fails to parse a USDC package with dependencies included", () => {
    expectError(
      () =>
        parseUsdcDeploy(
          suiExtensionsDeployOutput,
          stablecoinDeployOutput,
          usdcDeployWithDependenciesOutput
        ),
      "Expected 1 created object found matching '/upgrade_service::UpgradeService<w{66}::w*::w*>/', found 2"
    );
  });
});
