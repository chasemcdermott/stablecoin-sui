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

/// Module: coin_store
module coin_store::coin_store {
    use sui::coin::{Coin};

    #[allow(lint(coin_field))]
    public struct CoinStore<phantom T> has key {
        id: UID,
        coin: Coin<T>,
    }

    public fun wrap_and_transfer<T>(coin: Coin<T>, recipient: address, ctx: &mut TxContext) {
        transfer::transfer(CoinStore {
            id: object::new(ctx),
            coin
        }, recipient);
    }

    public fun unwrap_and_transfer<T>(coin_store: CoinStore<T>, recipient: address) {
        let CoinStore { id, coin } = coin_store;
        object::delete(id);
        transfer::public_transfer(coin, recipient);
    }
}
