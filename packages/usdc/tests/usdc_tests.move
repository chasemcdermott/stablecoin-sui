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

#[test_only]
module usdc::usdc_tests {
  use std::{string, ascii};
  use sui::{
    test_scenario, 
    test_utils::{assert_eq},
    coin::{CoinMetadata, RegulatedCoinMetadata, DenyCap}
  };
  use stablecoin::treasury::{Treasury};
  use usdc::usdc::{Self, USDC};

  const DEPLOYER: address = @0x0;

  #[test]
  fun init__should_create_correct_number_of_objects() {
    let mut scenario = test_scenario::begin(DEPLOYER);
    usdc::init_for_testing(scenario.ctx());

    let previous_tx_effects = scenario.next_tx(DEPLOYER);
    assert_eq(previous_tx_effects.created().length(), 4);
    assert_eq(previous_tx_effects.frozen().length(), 1);
    assert_eq(previous_tx_effects.shared().length(), 2); // Shared metadata and treasury objects

    scenario.end();
  }

  #[test]
  fun init__should_create_correct_coin_metadata() {
    let mut scenario = test_scenario::begin(DEPLOYER);
    usdc::init_for_testing(scenario.ctx());

    scenario.next_tx(DEPLOYER);
    let metadata = scenario.take_shared<CoinMetadata<USDC>>();
    assert_eq(metadata.get_decimals(), 6);
    assert_eq(metadata.get_name(), string::utf8(b"USDC"));
    assert_eq(metadata.get_symbol(), ascii::string(b"USDC"));
    assert_eq(metadata.get_description(), string::utf8(b""));
    assert_eq(metadata.get_icon_url(), option::none());
    test_scenario::return_shared(metadata);

    scenario.end();
  }

  #[test]
  fun init__should_create_regulated_coin_metadata() {
    let mut scenario = test_scenario::begin(DEPLOYER);
    usdc::init_for_testing(scenario.ctx());

    scenario.next_tx(DEPLOYER);
    assert_eq(test_scenario::has_most_recent_immutable<RegulatedCoinMetadata<USDC>>(), true);

    scenario.end();
  }

  #[test]
  fun init__should_create_shared_treasury_and_wrap_treasury_cap() {
    let mut scenario = test_scenario::begin(DEPLOYER);
    usdc::init_for_testing(scenario.ctx());

    scenario.next_tx(DEPLOYER);
    let treasury = scenario.take_shared<Treasury<USDC>>();
    assert_eq(treasury.total_supply(), 0);
    test_scenario::return_shared(treasury);

    scenario.end();
  }

  #[test]
  fun init__should_transfer_deny_cap_to_deployer() {
    let mut scenario = test_scenario::begin(DEPLOYER);
    usdc::init_for_testing(scenario.ctx());

    scenario.next_tx(DEPLOYER);
    assert_eq(scenario.has_most_recent_for_sender<DenyCap<USDC>>(), true);

    scenario.end();
  }
}
