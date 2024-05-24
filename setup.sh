#!/bin/bash
#
# Copyright 2024 Circle Internet Financial, LTD. All rights reserved.
# 
# SPDX-License-Identifier: Apache-2.0
# 
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
# 
#     http://www.apache.org/licenses/LICENSE-2.0
# 
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

set -e

# In the CI, download the prebuilt debug mode binary for Ubuntu.
if [[ "$CI" == true ]]; then
  echo "Downloading the Sui binary from Github..."

  # Download and extract Sui binaries.
  mkdir -p ./bin/sui
  curl -L -o ./bin/sui/sui-v1.25.1.tgz https://github.com/MystenLabs/sui/releases/download/mainnet-v1.25.1/sui-mainnet-v1.25.1-ubuntu-x86_64.tgz
  tar -xvzf ./bin/sui/sui-v1.25.1.tgz -C ./bin/sui
  rm ./bin/sui/sui-v1.25.1.tgz

  # Replace the release mode Sui with the debug mode Sui binary.
  rm ./bin/sui/sui
  mv ./bin/sui/sui-debug ./bin/sui/sui

  # Add Sui binaries to PATH for the current shell.
  export PATH="$PWD/bin/sui:$PATH"

  # Add Sui binaries to the PATH for all other steps in the CI workflow.
  echo "$PWD/bin/sui" >> $GITHUB_PATH

# In all other environments, build the Sui binary from source in debug mode.
else
  echo "Building Sui binary from source in debug mode..."

  cargo install \
    --git https://github.com/MystenLabs/sui.git \
    --rev 6579e0ed9e432bae47a407daaf01f08c298bcb14 \
    --locked --debug sui  
fi

# Sanity check that the Sui binary was installed correctly
if ! command -v sui &> /dev/null || ! sui -V | grep -q 'sui 1.25.1-6579e0e'
then
  echo "Sui binary was not installed"
  exit 1
fi