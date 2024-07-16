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

import fs from "fs";
import path from "path";
import { buildPackageHelper } from "../scripts/helpers";

export function writePublishedAddressToPackageManifest(
  packageName: string,
  address: string
) {
  const moveTomlFilepath = getMoveTomlFilepath(packageName);
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
  buildPackageHelper({ packageName, withUnpublishedDependencies: false });
}

export function resetPublishedAddressInPackageManifest(packageName: string) {
  const moveTomlFilepath = getMoveTomlFilepath(packageName);
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
  buildPackageHelper({ packageName, withUnpublishedDependencies: false });
}

function getMoveTomlFilepath(packageName: string) {
  return path.join(__dirname, "..", "..", "packages", packageName, "Move.toml");
}
