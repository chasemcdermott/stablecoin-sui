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
module stablecoin::mint_allowance_tests {
    use sui::test_utils::{assert_eq};
    use stablecoin::mint_allowance;

    public struct MINT_ALLOWANCE_TESTS has drop {}

    #[test]
    fun create_and_mutate_mint_allowance__should_succeed() {
        let mut allowance = mint_allowance::new<MINT_ALLOWANCE_TESTS>();
        assert_eq(allowance.value(), 0);

        allowance.set(1);
        assert_eq(allowance.value(), 1);

        allowance.decrease(1);
        assert_eq(allowance.value(), 0);

        allowance.set(5);
        assert_eq(allowance.value(), 5);

        allowance.destroy();
    }

    #[test, expected_failure(abort_code = ::stablecoin::mint_allowance::EOverflow)]
    fun decrease__should_fail_with_overflow() {
        let mut allowance = mint_allowance::new<MINT_ALLOWANCE_TESTS>();
        assert_eq(allowance.value(), 0);

        allowance.decrease(1);
        allowance.destroy();
    }
}
