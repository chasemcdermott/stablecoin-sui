#!/bin/bash
#
# Copyright 2024 Circle Internet Group, Inc. All rights reserved.
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

if [[ "$CI" == true ]]
then
  OS="ubuntu-x86_64"
else
  OS="macos-arm64"
fi

SUI_VERSION="1.30.1"
SUI_INSTALLATION_DIRECTORY="$HOME/.sui/bin"

if ! command -v sui &> /dev/null || ! sui -V | grep -q "sui $SUI_VERSION-"
then
  echo "Installing Sui binary from Github..."
  echo ">> Version: '$SUI_VERSION'"
  echo ">> OS: '$OS'"

  # Download and extract Sui binaries.
  rm -rf "$SUI_INSTALLATION_DIRECTORY"
  mkdir -p "$SUI_INSTALLATION_DIRECTORY"
  curl -L -o "$SUI_INSTALLATION_DIRECTORY/sui-v$SUI_VERSION.tgz" "https://github.com/MystenLabs/sui/releases/download/mainnet-v$SUI_VERSION/sui-mainnet-v$SUI_VERSION-$OS.tgz"
  tar -xvzf "$SUI_INSTALLATION_DIRECTORY/sui-v$SUI_VERSION.tgz" -C "$SUI_INSTALLATION_DIRECTORY"
  rm "$SUI_INSTALLATION_DIRECTORY/sui-v$SUI_VERSION.tgz"

  # Sanity check that the Sui binary was installed correctly
  echo "Checking sui installation..."
  if ! "$SUI_INSTALLATION_DIRECTORY/sui" -V | grep -q "sui $SUI_VERSION-"
  then
    echo "Sui binary was not installed correctly"
    exit 1
  fi

  if [[ "$CI" == true ]]
  then
    echo "$SUI_INSTALLATION_DIRECTORY" >> $GITHUB_PATH
  else
    echo "    Sui binary installed successfully. Run the following command to add 'sui' to your shell"
    echo "    echo 'export PATH=\"$SUI_INSTALLATION_DIRECTORY:\$PATH\"' >> ~/.zshrc"
  fi
fi

# ==== Yarn Installation ====
YARN_VERSION="^1.x.x"
YARN_VERSION_REGEX="^1\..*\..*"

if ! command -v yarn &> /dev/null || ! yarn --version | grep -q "$YARN_VERSION_REGEX"
then
  echo "Installing yarn..."
  npm install -g "yarn@$YARN_VERSION"

  # Sanity check that yarn was installed correctly
  echo "Checking yarn installation..."
  if ! yarn --version | grep -q "$YARN_VERSION_REGEX"
  then
    echo "Yarn was not installed correctly"
    exit 1
  fi
fi

echo "Setup completed!"
