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

### Deploying Move packages

#### Deploying with Sui CLI 

Packages in this repo can be published [via the Sui CLI](https://docs.sui.io/guides/developer/first-app/publish).

#### Deploying with Typescript 

For a more streamlined deploy and configuration process, use deploy scripts under `typescript/scripts` directory. 

1. Setup local deploy environment
```bash
cd typescript
nvm use
yarn install --frozen-lockfile
```

2. Configure environment variables
Copy `.env.example` file and specify values needed for deployment.
```
cp .env.example .env
```
The values typically needed are

- RPC URL: this should be a fullnode URL for where your packages will be published. 
- Faucet URL (for test environments only) if you need to request test SUI tokens from a faucet. 
- A deployer private key (see step below).

3. Prepare deployer key
Before deploying, you need to prepare a deployer address with some SUI on the network where the packages will be published. 
You can generate a deployer key locally using
```bash
yarn ts-node scripts/generateKeypair.ts
```
If you want a key to be prefunded with some test SUI tokens (for test environments only), run 
```bash
yarn ts-node scripts/generateKeypair.ts --prefund
```
Add the deployer private key to local `.env` configuration so it can be reused across multiple scripts.

4. Start local network
From project root
```bash
bash run.sh start_network
```

5. Run deploy script
```bash
yarn ts-node scripts/deploy.ts <package_name> --upgrade-cap-recipient <UPGRADE_CAP_RECIPIENT>
```