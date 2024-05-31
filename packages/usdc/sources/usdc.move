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

module usdc::usdc {
  use sui::coin;
  use stablecoin::treasury;

  /// The One-Time Witness struct for the USDC coin.
  public struct USDC has drop {}

  #[allow(lint(share_owned))]
  fun init(witness: USDC, ctx: &mut TxContext) {
    let (treasury_cap, deny_cap, metadata) = coin::create_regulated_currency(
      witness,
      6,               // decimals
      b"USDC",         // symbol
      b"USDC",         // name
      b"",             // description
      option::none(),  // icon url
      ctx
    );

    let treasury = treasury::create_treasury(
      treasury_cap, 
      ctx.sender(), // treasury admin
      ctx
    );
    
    transfer::public_transfer(deny_cap, ctx.sender());
    transfer::public_share_object(metadata);
    transfer::public_share_object(treasury);
  }

  #[test_only]
  public fun init_for_testing(ctx: &mut TxContext) {
    init(USDC {}, ctx)
  }
}
