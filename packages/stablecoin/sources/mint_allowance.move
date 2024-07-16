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

module stablecoin::mint_allowance {

    /// For when an overflow is happening on Supply operations.
    const EOverflow: u64 = 0;

    /// A MintAllowance of T. Used for minting and burning.
    public struct MintAllowance<phantom T> has store {
        value: u64
    }

    /// Get the amount stored in a `Balance`.
    public(package) fun value<T>(self: &MintAllowance<T>): u64 {
        self.value
    }

    /// Create a new MintAllowance for type T.
    public(package) fun create<T>(): MintAllowance<T> {
        MintAllowance { value: 0 }
    }

    /// Set allowance to `value`
    public(package) fun set<T>(self: &mut MintAllowance<T>, value: u64) {
       self.value = value;
    }

    /// Decrease allowance by `value`
    public(package) fun decrease<T>(self: &mut MintAllowance<T>, value: u64) {
        assert!(self.value >= value, EOverflow);
        self.value = self.value - value;
    }

    /// Destroy object
    public(package) fun destroy<T>(self: MintAllowance<T>) {
        let MintAllowance { value: _ } = self;
    }
}
