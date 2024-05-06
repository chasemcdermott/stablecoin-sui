# stablecoin-sui
Source repository for smart contracts used by Circle's stablecoins on Sui blockchain

## Getting Started

### Prerequisites
Before you can start working with the contracts in this repository, make sure you have the following prerequisites installed:

- [Sui command-line interface (CLI)](https://docs.sui.io/build/install)

### IDE
- VSCode is recommended for developing Move contracts.
- [Move (Extension)](https://marketplace.visualstudio.com/items?itemName=mysten.move) is a language server extension for Move. **Note**: additional installation steps required. Please follow the plugin's installation guide. 
- [Move Syntax](https://marketplace.visualstudio.com/items?itemName=damirka.move-syntax) a simple syntax highlighting extension for Move.

### Build and Test move contracts

1. Compile Move contracts from project root:
   ```bash
   sui move build
   ```

2. Run the tests:
   ```bash
   sui move test
   ```
