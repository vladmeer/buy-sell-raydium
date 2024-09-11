import {
  PublicKey, Keypair, Connection, Transaction, ComputeBudgetProgram,
  sendAndConfirmTransaction, VersionedTransaction, TransactionMessage,
  TransactionInstruction
} from "@solana/web3.js";
import {
  NATIVE_MINT, TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddress, getMint, getMinimumBalanceForRentExemptAccount,
} from "@solana/spl-token";
import base58 from "bs58";
import { retrieveEnvVariable } from "./src/utils";
import { Liquidity, LiquidityPoolKeysV4, Percent, CurrencyAmount, Token, SOL, LiquidityPoolInfo } from "@raydium-io/raydium-sdk";
import { derivePoolKeys } from "./src/poolAll";
import { BN } from "bn.js";

// Environment Variables3
const baseMintStr = "6LRHCKvqCX9JuQj8Fkx8yEM3c1PpyrV9NuPujc9Qpump";
const mainKpStr = retrieveEnvVariable('MAIN_KP');
const rpcUrl = retrieveEnvVariable("RPC_URL");
const poolId = "HRUsdnW2B49DQS64UoPJjcciRHSi3sBSBfnDmdEEzCRN";


// Solana Connection and Keypair
const connection = new Connection(rpcUrl, { commitment: "processed" });
const mainKp = Keypair.fromSecretKey(base58.decode(mainKpStr));
const baseMint = new PublicKey(baseMintStr);
const amount = 0.0001;

let poolKeys: LiquidityPoolKeysV4 | null = null;
let tokenAccountRent: number | null = null;
let decimal: number | null = null;
let poolInfo: LiquidityPoolInfo | null = null;

/**
 * Executes a buy and sell transaction for a given token.
 * @param {PublicKey} token - The token's public key.
 */
const buySellToken = async (token: PublicKey) => {
  try {
    if (!tokenAccountRent)
      tokenAccountRent = await getMinimumBalanceForRentExemptAccount(connection);
    if (!decimal)
      decimal = (await getMint(connection, token)).decimals;
    console.log(decimal)
    if (!poolKeys) {
      poolKeys = await derivePoolKeys(new PublicKey(poolId))
      console.log("🚀 ~ buySellToken ~ poolKeys:", poolKeys)

      if (!poolKeys) {
        console.log("Pool keys is not derived")
        return
      }
    }

    const solBuyAmountLamports = Math.floor(amount * 10 ** 9);
    const quoteAta = await getAssociatedTokenAddress(NATIVE_MINT, mainKp.publicKey);
    const baseAta = await getAssociatedTokenAddress(token, mainKp.publicKey);

    const slippage = new Percent(100, 100);
    const inputTokenAmount = new CurrencyAmount(SOL, solBuyAmountLamports);
    const outputToken = new Token(TOKEN_PROGRAM_ID, baseMint, decimal);
    try {
      if (!poolInfo)
        poolInfo = await Liquidity.fetchInfo({ connection, poolKeys })


      console.log("🚀 ~ buySellToken ~ poolInfo:", poolInfo)

      const { amountOut, minAmountOut } = Liquidity.computeAmountOut({
        poolKeys,
        poolInfo,
        amountIn: inputTokenAmount,
        currencyOut: outputToken,
        slippage,
      });
      console.log("🚀 ~ buySellToken ~ amountOut:", amountOut.raw.toString())

      const { amountIn, maxAmountIn } = Liquidity.computeAmountIn({
        poolKeys,
        poolInfo,
        amountOut,
        currencyIn: SOL,
        slippage
      })
      console.log("🚀 ~ buySellToken ~ maxAmountIn:", maxAmountIn.raw.toString())

      const { innerTransaction: innerBuyIxs } = Liquidity.makeSwapFixedOutInstruction(
        {
          poolKeys: poolKeys,
          userKeys: {
            tokenAccountIn: quoteAta,
            tokenAccountOut: baseAta,
            owner: mainKp.publicKey,
          },
          maxAmountIn: maxAmountIn.raw,
          amountOut: amountOut.raw,
        },
        poolKeys.version,
      )

      const { innerTransaction: innerSellIxs } = Liquidity.makeSwapFixedInInstruction(
        {
          poolKeys: poolKeys,
          userKeys: {
            tokenAccountIn: baseAta,
            tokenAccountOut: quoteAta,
            owner: mainKp.publicKey,
          },
          amountIn: amountOut.raw.sub(new BN(10 ** (decimal ? decimal : 6))),
          minAmountOut: 0,
        },
        poolKeys.version,
      );

      const instructions: TransactionInstruction[] = [];
      const latestBlockhash = await connection.getLatestBlockhash();
      instructions.push(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 744_452 }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: 183_504 }),
        createAssociatedTokenAccountIdempotentInstruction(
          mainKp.publicKey,
          quoteAta,
          mainKp.publicKey,
          NATIVE_MINT,
        ),
        // createSyncNativeInstruction(quoteAta, TOKEN_PROGRAM_ID),
        createAssociatedTokenAccountIdempotentInstruction(
          mainKp.publicKey,
          baseAta,
          mainKp.publicKey,
          token
        ),
        ...innerBuyIxs.instructions,
        ...innerSellIxs.instructions,
      )

      const messageV0 = new TransactionMessage({
        payerKey: mainKp.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions,
      }).compileToV0Message()

      const transaction = new VersionedTransaction(messageV0);
      transaction.sign([mainKp])

      console.log(await connection.simulateTransaction(transaction))
      const sig = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: true })
      const confirmation = await connection.confirmTransaction(
        {
          signature: sig,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          blockhash: latestBlockhash.blockhash,
        },
        "confirmed"
      )
      if (confirmation.value.err) {
        console.log("Confrimtaion error")
        return null
      } else {
        console.log(`Buy and sell transaction: https://solscan.io/tx/${sig}`)
      }
    } catch (error) {
      console.log("🚀 ~ feth info ~ error:", error)

    }
  } catch (error) {
    console.log("🚀 ~ buySellToken ~ error:", error)
  }
};

/**
 * Main function to run the maker bot.
 */
const run = async () => {

  console.log("main keypair, ", mainKp.publicKey.toBase58())
  console.log("main keypair balance : ", await connection.getBalance(mainKp.publicKey))
  await buySellToken(baseMint);
};
// Main function that runs the bot
(async () => { run(); })();

