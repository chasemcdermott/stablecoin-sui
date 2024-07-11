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

function clean() {
  for path in $(_get_packages); do
    echo ">> Cleaning $path..."
    rm -rf $path/build
    rm -f $path/.coverage_map.mvcov
    rm -f $path/.trace
  done
}

function build() {
  for path in $(_get_packages); do
    echo ">> Building $path..."
    sui move build --path $path
  done
}

function test() {
  for path in $(_get_packages); do
    echo ">> Testing $path..."
    sui move test --path "$path" --statistics --coverage

    if [ -f $path/.coverage_map.mvcov ]
    then
      echo ">> Printing coverage results for $path..."
      sui move coverage summary --path "$path"
    fi
  done
}

function start_network() {
  docker run -d \
    -p 9001:7000 \
    -p 9123:7123 \
    --name sui-network \
    124945441934.dkr.ecr.us-east-1.amazonaws.com/blockchain/sui/sui:devnet-afe6d26-v1.29.0
}

function stop_network() {
  docker kill sui-network && docker rm sui-network
}

function _get_packages() {
  find "packages" -type d -mindepth 1 -maxdepth 1
}

# This script takes in a function name as the first argument, 
# and runs it in the context of the script.
if [ -z $1 ]; then
  echo "Usage: bash run.sh <function>";
  exit 1;
elif declare -f "$1" > /dev/null; then
  "$@";
else
  echo "Function '$1' does not exist";
  exit 1;
fi
