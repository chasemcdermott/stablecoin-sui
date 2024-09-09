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

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_INTERVAL_MS = 500;

/**
 * Polls every 500ms until the next epoch starts.
 */
export async function waitUntilNextEpoch(client: SuiClient) {
  const startEpoch = Number((await client.getLatestSuiSystemState()).epoch);
  return waitUntil(
    "Next epoch",
    async () => {
      const currentEpoch = Number(
        (await client.getLatestSuiSystemState()).epoch
      );
      assert.equal(currentEpoch > startEpoch, true);
    },
    30000, // 30 second timeout
    500
  );
}

/**
 * Executes the runnable until it succeeds or the timeout is reached.
 */
export async function waitUntil(
  title: string,
  runnable: () => Promise<void>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  delayMs = DEFAULT_INTERVAL_MS
) {
  const start = Date.now();
  while (true) {
    try {
      await runnable();
      break;
    } catch (error) {
      const timeSinceStart = start - Date.now();
      if (timeSinceStart > timeoutMs) {
        throw Error(`Timed out before '${title}'. ${error}`);
      }
      // else continue
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
