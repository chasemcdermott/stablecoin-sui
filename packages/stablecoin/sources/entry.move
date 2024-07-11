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

/// This module exposes entry functions for the stablecoin module to support calling functions on
/// wrapped objects from PTBs. Currently PTBs are unable to chain a reference from the output of one
/// function to the input of another, making it difficult to call functions on wrapped objects.
/// This module exposes those functions directly using entry functions.
module stablecoin::entry {
    use stablecoin::treasury::Treasury;

    // === Entry Functions ===

    /// Start owner role transfer process.
    entry fun transfer_ownership<T>(treasury: &mut Treasury<T>, new_owner: address, ctx: &TxContext) {
        treasury.roles_mut().transfer_ownership<T>(new_owner, ctx)
    }

    /// Finalize owner role transfer process.
    entry fun accept_ownership<T>(treasury: &mut Treasury<T>, ctx: &TxContext) {
      treasury.roles_mut().accept_ownership<T>(ctx)
    }

    /// Change the master minter address.
    entry fun update_master_minter<T>(treasury: &mut Treasury<T>, new_master_minter: address, ctx: &TxContext) {
      treasury.roles_mut().update_master_minter<T>(new_master_minter, ctx)
    }

    /// Change the blocklister address.
    entry fun update_blocklister<T>(treasury: &mut Treasury<T>, new_blocklister: address, ctx: &TxContext) {
      treasury.roles_mut().update_blocklister<T>(new_blocklister, ctx)
    }

    /// Change the pauser address.
    entry fun update_pauser<T>(treasury: &mut Treasury<T>, new_pauser: address, ctx: &TxContext) {
      treasury.roles_mut().update_pauser<T>(new_pauser, ctx)
    }

    /// Change the metadata updater address.
    entry fun update_metadata_updater<T>(treasury: &mut Treasury<T>, new_metadata_updater: address, ctx: &TxContext) {
      treasury.roles_mut().update_metadata_updater<T>(new_metadata_updater, ctx)
    }
}
