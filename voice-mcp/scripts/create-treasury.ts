import { Keypair } from "@solana/web3.js";

/**
 * Run once to mint the treasury wallet that funds everyone else's devnet
 * wallet. Put the printed secret key in SOLANA_TREASURY_SECRET_KEY, then
 * airdrop devnet SOL into the printed public key with the Solana CLI:
 *
 *   solana airdrop 5 <public key> --url devnet
 *
 * That SOL is free test currency, not real money - only mainnet-beta SOL
 * costs anything.
 */
const keypair = Keypair.generate();
console.log("public key (fund this with the devnet faucet):");
console.log(keypair.publicKey.toBase58());
console.log("\nSOLANA_TREASURY_SECRET_KEY (put this in your .env, keep it out of git):");
console.log(JSON.stringify(Array.from(keypair.secretKey)));
