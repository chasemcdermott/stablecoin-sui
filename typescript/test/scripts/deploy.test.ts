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

import { strict as assert } from "assert";
import { deploy } from "../../scripts/deploy";
import { generateKeypair } from "../../scripts/generateKeypair";

describe("Test deploy script", () => {
  it("Deploys stablecoin package successfully", async () => {
    const deployerKeys = await generateKeypair(true);
    const upgraderKeys = await generateKeypair(false);

    const txOutput = await deploy(
      "stablecoin",
      process.env.RPC_URL as string,
      deployerKeys.getSecretKey(),
      upgraderKeys.toSuiAddress() // upgrader address
    );

    const { objectChanges } = txOutput;
    const createdObjects =
      objectChanges?.filter((c) => c.type === "created") || [];
    const publishedObjects =
      objectChanges?.filter((c) => c.type === "published") || [];
    assert.equal(createdObjects.length, 1);
    assert.equal(publishedObjects.length, 1);

    const createdObj = createdObjects[0] as any;
    assert.equal(createdObj.objectType, "0x2::package::UpgradeCap");
    assert.equal(createdObj.sender, deployerKeys.toSuiAddress());
    assert.equal(createdObj.owner.AddressOwner, upgraderKeys.toSuiAddress());
  });
});
