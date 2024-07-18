// Copyright 2024 Circle Internet Financial, LTD. All rights reserved.
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

module stablecoin::stablecoin {
    use sui_extensions::typed_upgrade_cap;

    public struct STABLECOIN has drop {}

    /// Initializes an UpgradeCap<STABLECOIN> and transfers the UpgradeCap
    /// to the transaction's sender.
    fun init(witness: STABLECOIN, ctx: &mut TxContext) {
        let (typed_upgrade_cap, _) = typed_upgrade_cap::empty(witness, ctx);
        transfer::public_transfer(typed_upgrade_cap, ctx.sender());
    }

    #[test_only]
    public(package) fun init_for_testing(ctx: &mut TxContext) {
        init(STABLECOIN {}, ctx)
    }
}
