# stablecoin-sui

Source repository for smart contracts used by Circle's stablecoins on Sui blockchain

## Getting Started

### Prerequisites

Before you can start working with the contracts in this repository, make sure to:

1. Install Rust ([refer to documentations](https://doc.rust-lang.org/book/ch01-01-installation.html#installing-rustup-on-linux-or-macos))
2. Install Sui from source

```bash
bash setup.sh
```

### IDE

- VSCode is recommended for developing Move contracts.
- [Move (Extension)](https://marketplace.visualstudio.com/items?itemName=mysten.move) is a language server extension for Move.

### Build and Test move contracts

1. Compile Move contracts from project root:

```bash
bash run.sh build
```

2. Run the tests:

```bash
bash run.sh test
```
