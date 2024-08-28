// Copyright 2024 Circle Internet Group, Inc. All rights reserved.
//
// SPDX-License-Identifier: Apache-2.0
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

#[test_only]
module coin_store::coin_store_tests {
    use sui::coin;
    use sui::test_scenario;
    use coin_store::coin_store::{Self, CoinStore};

    const ALICE: address = @0x10;
    const BOB: address = @0x20;

    public struct CoinType has drop {}

    #[test]
    fun wrap_and_unwrap__should_succeed() {
        let mut scenario = test_scenario::begin(ALICE);
        
        scenario.next_tx(ALICE);
        {
            let new_coin = coin::mint_for_testing<CoinType>(1, scenario.ctx());
            coin_store::wrap_and_transfer(new_coin, BOB, scenario.ctx());
        };

        scenario.next_tx(BOB);
        {
            let stored_coin = scenario.take_from_sender<CoinStore<CoinType>>();
            coin_store::unwrap_and_transfer(stored_coin, ALICE);
        };

        scenario.end();
    }
}
