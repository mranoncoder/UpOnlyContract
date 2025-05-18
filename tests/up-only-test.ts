import { address } from 'web3js-experimental';
import { addons } from '@storybook/manager-api';
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, Keypair, SystemProgram } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddress,
  getMint,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  AccountNotFoundError,
} from '@solana/spl-token';
import { assert } from 'chai';

describe('UP ONLY TESTS', () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const wallet = provider.wallet as anchor.Wallet;
  const connection = provider.connection;
  const program = anchor.workspace.UpOnly as Program<anchor.Idl>;

  let usdcMint: PublicKey;
  let usdcTokenAccount: PublicKey;
  let upOnlyMint: PublicKey;
  let upOnlyTokenAccount: PublicKey;
  let mintAuthority: Keypair;
  let freezeAuthority: Keypair;
  let metadataPda: PublicKey;
  const buyer = Keypair.generate();
  let buyerUsdcAccount: PublicKey;
  const lockedUser = Keypair.generate();
  let lockedUserUsdcAccount: PublicKey;
  const referral = Keypair.generate();
  const secondUser = Keypair.generate();
  let referralUsdcAccount: PublicKey;
  let secondUserUsdcAccount: PublicKey;

  it('Creates a dummy USDC token and mints 1 million tokens', async () => {
    // Create a new mint
    mintAuthority = Keypair.generate();
    freezeAuthority = Keypair.generate();

    // Create the mint account
    usdcMint = await createMint(
      connection,
      wallet.payer,
      mintAuthority.publicKey,
      freezeAuthority.publicKey,
      6 // decimals (USDC uses 6 decimals)
    );

    // Get the token account of the wallet address, and if it does not exist, create it
    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      wallet.publicKey
    );
    usdcTokenAccount = tokenAccount.address;

    lockedUserUsdcAccount = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        wallet.payer,
        usdcMint,
        lockedUser.publicKey
      )
    ).address;
    referralUsdcAccount = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        wallet.payer,
        usdcMint,
        referral.publicKey
      )
    ).address;

    secondUserUsdcAccount = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        wallet.payer,
        usdcMint,
        secondUser.publicKey
      )
    ).address;

    // Fund both users with SOL for tx fees
    await Promise.all([
      connection.requestAirdrop(lockedUser.publicKey, 2e9),
      connection.requestAirdrop(referral.publicKey, 2e9),
      connection.requestAirdrop(secondUser.publicKey, 2e9),
    ]);

    // Mint 1 million tokens (1,000,000 * 10^6 for 6 decimals)
    const mintAmount = 1_000_000 * Math.pow(10, 6);
    await connection.requestAirdrop(buyer.publicKey, 2e9); // fund buyer

    buyerUsdcAccount = (
      await getOrCreateAssociatedTokenAccount(connection, wallet.payer, usdcMint, buyer.publicKey)
    ).address;

    await mintTo(
      connection,
      wallet.payer,
      usdcMint,
      buyerUsdcAccount,
      mintAuthority,
      12_000 * 10 ** 6
    );

    // Mint to referral
    await mintTo(
      connection,
      wallet.payer,
      usdcMint,
      referralUsdcAccount,
      mintAuthority,
      10_000 * 10 ** 6
    );

    // Mint to locked user
    await mintTo(
      connection,
      wallet.payer,
      usdcMint,
      lockedUserUsdcAccount,
      mintAuthority,
      10_000 * 10 ** 6
    );

    // Mint to second user
    await mintTo(
      connection,
      wallet.payer,
      usdcMint,
      secondUserUsdcAccount,
      mintAuthority,
      11_000 * 10 ** 6
    );

    await mintTo(
      connection,
      wallet.payer,
      usdcMint,
      tokenAccount.address,
      mintAuthority,
      mintAmount
    );

    // Get the token account balance
    const tokenAccountInfo = await getAccount(connection, tokenAccount.address);

    // Verify the balance
    assert.equal(
      Number(tokenAccountInfo.amount),
      mintAmount,
      'USDC token balance should be 1 million'
    );
  });

  it('Creates UpOnly token and mints 1 token', async () => {
    // Create a new mint for UpOnly token
    const upOnlyMintAuthority = Keypair.generate();
    const upOnlyFreezeAuthority = Keypair.generate();

    // Create the mint account with 9 decimals
    upOnlyMint = await createMint(
      connection,
      wallet.payer,
      upOnlyMintAuthority.publicKey,
      upOnlyFreezeAuthority.publicKey,
      9 // UpOnly uses 9 decimals
    );

    // Get or create the token account for the wallet
    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      upOnlyMint,
      wallet.publicKey
    );
    upOnlyTokenAccount = tokenAccount.address;

    // Mint 1 UpOnly token (1 * 10^9 for 9 decimals)
    const mintAmount = 1 * Math.pow(10, 9);

    await mintTo(
      connection,
      wallet.payer,
      upOnlyMint,
      tokenAccount.address,
      upOnlyMintAuthority,
      mintAmount
    );

    // Get the token account balance
    const tokenAccountInfo = await getAccount(connection, tokenAccount.address);

    // Verify the balance
    assert.equal(Number(tokenAccountInfo.amount), mintAmount, 'UpOnly token balance should be 1');

    // Store the mint authority for later use
    mintAuthority = upOnlyMintAuthority;
  });

  it('Initializes the program with the tokens', async () => {
    // Find the program's mint authority PDA
    const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('mint_authority')],
      program.programId
    );

    // Find the metadata PDA
    [metadataPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), upOnlyMint.toBuffer()],
      program.programId
    );

    // Find the program's token account PDAs
    const [programUpOnlyTokenAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('token_account'), upOnlyMint.toBuffer()],
      program.programId
    );

    const [programUsdcTokenAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('token_account'), usdcMint.toBuffer()],
      program.programId
    );

    // Create the program's token accounts using PDAs as owners
    const programUpOnlyAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      upOnlyMint,
      programUpOnlyTokenAccountPda, // Use the PDA as the owner
      true
    );

    const programUsdcAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      programUsdcTokenAccountPda, // Use the PDA as the owner
      true
    );

    // Create the user's UpOnly token account if it doesn't exist
    // Just before, request airdrop (in case you're running low on funds)
    await connection.requestAirdrop(wallet.publicKey, 1e9);

    // Force create fresh ATA
    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      upOnlyMint,
      wallet.publicKey,
      false
    );

    upOnlyTokenAccount = tokenAccount.address;

    const tokenAccountInfo = await getAccount(connection, upOnlyTokenAccount);

    if (tokenAccountInfo.owner.toBase58() !== wallet.publicKey.toBase58()) {
      throw new Error('Token account is not owned by the expected wallet');
    }

    if (tokenAccountInfo.mint.toBase58() !== upOnlyMint.toBase58()) {
      throw new Error('Token account mint does not match');
    }

    const associatedTokenAddress = await getAssociatedTokenAddress(upOnlyMint, wallet.publicKey);

    assert.equal(
      associatedTokenAddress.toBase58(),
      upOnlyTokenAccount.toBase58(),
      'Token account address mismatch'
    );
    const [foundersPoolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founders_pool')],
      program.programId
    );

    await program.methods
      .initialize()
      .accounts({
        upOnlyMint,
        metadata: metadataPda,
        userUpOnlyAccount: upOnlyTokenAccount,
        programUpOnlyAccount: programUpOnlyAccount.address,
        paymentTokenMint: usdcMint,
        userPaymentTokenAccount: usdcTokenAccount,
        programPaymentTokenAccount: programUsdcAccount.address,
        mintAuthority: mintAuthorityPda,
        currentMintAuthority: mintAuthority.publicKey,
        authority: wallet.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([wallet.payer, mintAuthority])
      .rpc();

    console.log('🧾 trying the inline founders pool:', foundersPoolPda.toBase58());

    const [founderAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founder_authority')],
      program.programId
    );

    const founderPoolTokenAccount = await getAssociatedTokenAddress(
      usdcMint,
      founderAuthorityPda,
      true
    );

    await program.methods
      .initializeFoundersPool()
      .accounts({
        foundersPool: foundersPoolPda,
        authority: wallet.publicKey,
        founderAuthority: founderAuthorityPda,
        founderPoolTokenAccount: founderPoolTokenAccount,
        usdcMint: usdcMint,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([wallet.payer])
      .rpc();

    const founderPoolTokenAccountInfo = await getAccount(connection, founderPoolTokenAccount);
    const balance = Number(founderPoolTokenAccountInfo.amount) / 1e6;
    console.log('🏦 Tokens in Founders Pool:', balance.toFixed(6), 'USDC');

    // Verify the program's UpOnly token account has 1 token
    const programUpOnlyInfo = await getAccount(connection, programUpOnlyAccount.address);
    assert.equal(
      Number(programUpOnlyInfo.amount),
      1 * Math.pow(10, 9),
      'Program should have 1 UpOnly token'
    );

    // Verify the program's USDC account has 1 USDC
    const programUsdcInfo = await getAccount(connection, programUsdcAccount.address);
    assert.equal(
      Number(programUsdcInfo.amount),
      0.003 * Math.pow(10, 6),
      'Program should have 1 USDC'
    );

    // Verify the mint authority was transferred
    const mintInfo = await getMint(connection, upOnlyMint);
    assert.equal(
      mintInfo.mintAuthority?.toBase58(),
      mintAuthorityPda.toBase58(),
      'Mint authority should be transferred to program'
    );
  });

  it.skip('Admin gives a user a free pass', async () => {
    const freePassUser = Keypair.generate();

    // Airdrop for fees
    await connection.requestAirdrop(freePassUser.publicKey, 2e9);

    const [freeUserStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('user_state'), freePassUser.publicKey.toBuffer()],
      program.programId
    );

    // Deployer gives pass for free
    await program.methods
      .givePass()
      .accounts({
        metadata: metadataPda,
        userState: freeUserStatePda,
        user: freePassUser.publicKey,
        deployer: wallet.publicKey,
      })
      .signers([wallet.payer])
      .rpc();

    const userState = await program.account.userState.fetch(freeUserStatePda);
    assert.isTrue(userState.hasPass, 'User should have received a free pass from admin');
  });

  it.skip('Unauthorized user cannot give a free pass', async () => {
    const attacker = Keypair.generate();
    const victim = Keypair.generate();

    await connection.requestAirdrop(attacker.publicKey, 2e9);
    await connection.requestAirdrop(victim.publicKey, 2e9);

    const [victimUserStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('user_state'), victim.publicKey.toBuffer()],
      program.programId
    );

    let failed = false;
    try {
      await program.methods
        .givePass()
        .accounts({
          metadata: metadataPda,
          userState: victimUserStatePda,
          user: victim.publicKey,
          deployer: attacker.publicKey, // ❌ Not the real deployer
        })
        .signers([attacker])
        .rpc();
    } catch (err) {
      failed = true;
      console.log('❌ Unauthorized user failed as expected');
    }

    assert.isTrue(failed, 'Unauthorized user should not be able to give free pass');
  });

  it.skip('Admin adds two people to the founder pool', async () => {
    const [foundersPoolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founders_pool')],
      program.programId
    );

    // Add first founder (referral)
    const tx1 = await program.methods
      .addFounder(referral.publicKey)
      .accounts({
        metadata: metadataPda,
        foundersPool: foundersPoolPda,
        deployer: wallet.publicKey,
      })
      .signers([wallet.payer])
      .rpc();

    console.log('✅ Founder 1 added, tx:', tx1);

    // Add second founder (secondUser)
    const tx2 = await program.methods
      .addFounder(secondUser.publicKey)
      .accounts({
        metadata: metadataPda,
        foundersPool: foundersPoolPda,
        deployer: wallet.publicKey,
      })
      .signers([wallet.payer])
      .rpc();

    console.log('✅ Founder 2 added, tx:', tx2);

    // Fetch pool and assert both were added
    const pool = await program.account.foundersPool.fetch(foundersPoolPda);
    assert.equal(
      pool.founders[0].toBase58(),
      referral.publicKey.toBase58(),
      'Founder 1 was not added correctly'
    );
    assert.equal(
      pool.founders[1].toBase58(),
      secondUser.publicKey.toBase58(),
      'Founder 2 was not added correctly'
    );
  });

  it.skip('Unauthorized user cannot add a founder to the pool', async () => {
    const [foundersPoolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founders_pool')],
      program.programId
    );

    const attacker = Keypair.generate();
    const fakeFounder = Keypair.generate();

    // Fund attacker with SOL
    await connection.requestAirdrop(attacker.publicKey, 2e9);

    let failed = false;
    try {
      await program.methods
        .addFounder(fakeFounder.publicKey)
        .accounts({
          metadata: metadataPda,
          foundersPool: foundersPoolPda,
          deployer: attacker.publicKey, // ❌ Not the actual deployer
        })
        .signers([attacker])
        .rpc();
    } catch (err) {
      failed = true;
      console.log('❌ Unauthorized user failed to add founder as expected');
    }

    assert.isTrue(failed, 'Unauthorized user should not be able to add founder');
  });

  it.skip('User buys a pass for 10,000 USDC', async () => {
    const [userStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('user_state'), buyer.publicKey.toBuffer()],
      program.programId
    );

    const deployerUsdcAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      wallet.publicKey
    );

    const buyerStart = Number((await getAccount(connection, buyerUsdcAccount)).amount);

    // Execute buy_pass
    await program.methods
      .buyPass(null)
      .accounts({
        user: buyer.publicKey,
        userState: userStatePda,
        userUsdcAccount: buyerUsdcAccount,
        deployerUsdcAccount: deployerUsdcAccount.address,
        referralUsdcAccount: null,
        metadata: metadataPda,
        upOnlyMint: upOnlyMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([buyer])
      .rpc();

    const userState = await program.account.userState.fetch(userStatePda);
    assert.isTrue(userState.hasPass, 'User should have pass after purchase');

    const buyerEnd = Number((await getAccount(connection, buyerUsdcAccount)).amount);

    assert.equal(
      buyerStart - buyerEnd,
      10_000 * 10 ** 6,
      'Buyer should have spent exactly 10,000 USDC'
    );
  });

  it.skip('Another user buys a pass with referral and funds are split', async () => {
    const [secondUserStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('user_state'), secondUser.publicKey.toBuffer()],
      program.programId
    );

    const referralStart = Number((await getAccount(connection, referralUsdcAccount)).amount);
    const deployerStart = Number((await getAccount(connection, usdcTokenAccount)).amount);

    await program.methods
      .buyPass(referral.publicKey)
      .accounts({
        user: secondUser.publicKey,
        userState: secondUserStatePda,
        userUsdcAccount: secondUserUsdcAccount,
        deployerUsdcAccount: usdcTokenAccount,
        referralUsdcAccount: referralUsdcAccount,
        metadata: metadataPda,
        upOnlyMint: upOnlyMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([secondUser])
      .rpc();

    const userState = await program.account.userState.fetch(secondUserStatePda);
    assert.isTrue(userState.hasPass, 'New user should have pass after purchase');

    assert.equal(
      userState.referral.toBase58(),
      referral.publicKey.toBase58(),
      'Referral should be correctly saved'
    );

    const referralEnd = Number((await getAccount(connection, referralUsdcAccount)).amount);
    const deployerEnd = Number((await getAccount(connection, usdcTokenAccount)).amount);

    assert.equal(
      referralEnd - referralStart,
      5_000 * 10 ** 6,
      'Referral should receive 5,000 USDC'
    );

    assert.equal(
      deployerEnd - deployerStart,
      5_000 * 10 ** 6,
      'Deployer should receive 5,000 USDC'
    );
  });

  it.skip('Buyer buys Tokens after having a pass', async () => {
    const [userStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('user_state'), buyer.publicKey.toBuffer()],
      program.programId
    );

    const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('mint_authority')],
      program.programId
    );

    const buyerUpTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      upOnlyMint,
      buyer.publicKey
    );

    const lockedLiquidityAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      wallet.publicKey
    );

    const deployerUsdcAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      wallet.publicKey
    );

    const buyerStart = Number((await getAccount(connection, buyerUsdcAccount)).amount);
    const buyerBalance = await getAccount(connection, buyerUsdcAccount);
    console.log('Buyer USDC balance:', Number(buyerBalance.amount));

    const [programUsdcTokenAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('token_account'), usdcMint.toBuffer()],
      program.programId
    );

    const programUsdcAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      programUsdcTokenAccountPda,
      true
    );

    const programUsdcBefore = Number(
      (await getAccount(connection, programUsdcAccount.address)).amount
    );

    const [programUpOnlyTokenAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('token_account'), upOnlyMint.toBuffer()],
      program.programId
    );

    const tokenBalanceBefore = Number(
      (await getAccount(connection, buyerUpTokenAccount.address)).amount
    );

    const [foundersPoolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founders_pool')],
      program.programId
    );

    const [founderAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founder_authority')],
      program.programId
    );

    const founderPoolTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      founderAuthorityPda,
      true
    );

    const tx = await program.methods
      .buyToken(new anchor.BN(1_000_000_000), null) // 1000 USDC
      .accounts({
        user: buyer.publicKey,
        userState: userStatePda,
        userUsdcAccount: buyerUsdcAccount,
        userTokenAccount: buyerUpTokenAccount.address,
        deployerUsdcAccount: deployerUsdcAccount.address,
        lockedLiquidityUsdc: lockedLiquidityAccount.address,
        programPaymentTokenAccount: programUsdcAccount.address,
        metadata: metadataPda,
        tokenMint: upOnlyMint,
        mintAuthority: mintAuthorityPda,
        referralUsdcAccount: null,
        founderPoolTokenAccount: founderPoolTokenAccount.address,
        foundersPool: foundersPoolPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([buyer])
      .rpc();

    console.log('Buy token tx:', tx);

    const buyerEnd = Number((await getAccount(connection, buyerUsdcAccount)).amount);
    const tokenBalanceAfter = Number(
      (await getAccount(connection, buyerUpTokenAccount.address)).amount
    );

    const programUsdcAfter = Number(
      (await getAccount(connection, programUsdcAccount.address)).amount
    );

    const usdcSpent = buyerStart - buyerEnd;
    const tokensReceived = tokenBalanceAfter - tokenBalanceBefore;
    const avgPricePaid = usdcSpent / 1e6 / (tokensReceived / 1e9);

    console.log('💸 Average price paid this buy:', avgPricePaid.toFixed(6));
    console.log('buyerStart', buyerStart);
    console.log('Buyer USDC balance:', buyerEnd);
    console.log('tokenBalanceBefore', tokenBalanceBefore);
    console.log('tokenBalance:', tokenBalanceAfter);
    console.log('programUsdcBefore', programUsdcBefore);
    console.log('programUsdcAfter', programUsdcAfter);

    assert.equal(buyerStart - buyerEnd, 1_000_000_000, 'Buyer should have spent 1000 USDC');
    assert.isAbove(tokenBalanceAfter, 0, 'Buyer should have received tokens');
  });

  it.skip('Second user Buys tokens with 1000 USDC', async () => {
    const [secondUserStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('user_state'), secondUser.publicKey.toBuffer()],
      program.programId
    );
    const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('mint_authority')],
      program.programId
    );
    const [programUsdcTokenAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('token_account'), usdcMint.toBuffer()],
      program.programId
    );

    const programUsdcAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      programUsdcTokenAccountPda,
      true
    );

    const lockedLiquidityAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      wallet.publicKey
    );
    const deployerUsdcAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      wallet.publicKey
    );

    const secondUserUpTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      upOnlyMint,
      secondUser.publicKey
    );

    const secondUserStart = Number((await getAccount(connection, secondUserUsdcAccount)).amount);
    const tokenBalanceBefore = Number(
      (await getAccount(connection, secondUserUpTokenAccount.address)).amount
    );

    const [foundersPoolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founders_pool')],
      program.programId
    );

    const [founderAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founder_authority')],
      program.programId
    );

    const founderPoolTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      founderAuthorityPda,
      true
    );

    // Buy tokens
    const tx = await program.methods
      .buyToken(new anchor.BN(1_000_000_000), referral.publicKey)
      .accounts({
        user: secondUser.publicKey,
        userState: secondUserStatePda,
        userUsdcAccount: secondUserUsdcAccount,
        userTokenAccount: secondUserUpTokenAccount.address,
        deployerUsdcAccount: deployerUsdcAccount.address,
        lockedLiquidityUsdc: lockedLiquidityAccount.address,
        programPaymentTokenAccount: programUsdcAccount.address,
        metadata: metadataPda,
        tokenMint: upOnlyMint,
        mintAuthority: mintAuthorityPda,
        referralUsdcAccount: referralUsdcAccount,
        founderPoolTokenAccount: founderPoolTokenAccount.address,
        foundersPool: foundersPoolPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([secondUser])
      .rpc();

    const secondUserEnd = Number((await getAccount(connection, secondUserUsdcAccount)).amount);
    const tokenBalanceAfter = Number(
      (await getAccount(connection, secondUserUpTokenAccount.address)).amount
    );

    const usdcSpent = secondUserStart - secondUserEnd;
    const tokensReceived = tokenBalanceAfter - tokenBalanceBefore;
    const avgPricePaid = usdcSpent / 1e6 / (tokensReceived / 1e9);

    console.log('tokenBalanceBefore', tokenBalanceBefore);
    console.log('tokenBalanceAfter', tokenBalanceAfter);
    console.log('👤 Second Buyer');
    console.log('💸 Average price paid:', avgPricePaid.toFixed(6));

    assert.equal(usdcSpent, 1_000_000_000, 'Second user should spend 1000 USDC');
    assert.isAbove(tokensReceived, 0, 'Second user should receive tokens');
  });

  it.skip('Buyer sells tokens after Second user buys', async () => {
    const [userStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('user_state'), buyer.publicKey.toBuffer()],
      program.programId
    );

    const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('mint_authority')],
      program.programId
    );

    const [poolAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('token_account'), usdcMint.toBuffer()],
      program.programId
    );

    const buyerUpTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      upOnlyMint,
      buyer.publicKey
    );

    const buyerUsdcBefore = Number((await getAccount(connection, buyerUsdcAccount)).amount);
    const buyerTokenBefore = Number(
      (await getAccount(connection, buyerUpTokenAccount.address)).amount
    );

    const programUsdcAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      poolAuthority,
      true
    );

    const deployerUsdcAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      wallet.publicKey
    );

    // Sell half of the tokens user owns
    const amountToSell = buyerTokenBefore;

    const programUsdcBefore = Number(
      (await getAccount(connection, programUsdcAccount.address)).amount
    );

    const [foundersPoolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founders_pool')],
      program.programId
    );

    const [founderPoolTokenAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founder_pool_token_account'), usdcMint.toBuffer()],
      program.programId
    );

    const [founderAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founder_authority')],
      program.programId
    );

    const founderPoolTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      founderAuthorityPda,
      true
    );

    console.log('👤 Seller USDC before:', buyerUsdcBefore / 1e6);
    await program.methods
      .sellToken(new anchor.BN(amountToSell))
      .accounts({
        user: buyer.publicKey,
        userState: userStatePda,
        userTokenAccount: buyerUpTokenAccount.address,
        userUsdcAccount: buyerUsdcAccount,
        deployerUsdcAccount: deployerUsdcAccount.address,
        programPaymentTokenAccount: programUsdcAccount.address,
        metadata: metadataPda,
        tokenMint: upOnlyMint,
        mintAuthority: mintAuthorityPda,

        poolAuthority: poolAuthority,
        referralUsdcAccount: null,
        founderPoolTokenAccount: founderPoolTokenAccount.address,
        foundersPool: foundersPoolPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([buyer])
      .rpc();

    const buyerUsdcAfter = Number((await getAccount(connection, buyerUsdcAccount)).amount);
    const buyerTokenAfter = Number(
      (await getAccount(connection, buyerUpTokenAccount.address)).amount
    );

    console.log('👤 Seller USDC after: ', buyerUsdcAfter / 1e6);
    console.log('📉 Tokens before:', buyerTokenBefore / 1e9);
    console.log('📉 Tokens after: ', buyerTokenAfter / 1e9);

    const programUsdcAfter = Number(
      (await getAccount(connection, programUsdcAccount.address)).amount
    );
    console.log('📊 Program USDC before:', programUsdcBefore / 1e6);
    console.log('📊 Program USDC after: ', programUsdcAfter / 1e6);
    assert.isBelow(
      buyerTokenAfter,
      buyerTokenBefore,
      'Buyer should have fewer tokens after selling'
    );
    assert.isAbove(buyerUsdcAfter, buyerUsdcBefore, 'Buyer should have more USDC after selling');
  });

  it.skip('Second user sells tokens and referral receives 2.5%', async () => {
    const [secondUserStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('user_state'), secondUser.publicKey.toBuffer()],
      program.programId
    );

    const [poolAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('token_account'), usdcMint.toBuffer()],
      program.programId
    );

    const secondUserUpTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      upOnlyMint,
      secondUser.publicKey
    );

    const secondUserTokenBefore = Number(
      (await getAccount(connection, secondUserUpTokenAccount.address)).amount
    );

    const secondUserUsdcBefore = Number(
      (await getAccount(connection, secondUserUsdcAccount)).amount
    );
    const referralUsdcBefore = Number((await getAccount(connection, referralUsdcAccount)).amount);
    const deployerUsdcBefore = Number((await getAccount(connection, usdcTokenAccount)).amount);

    const programUsdcAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      poolAuthority,
      true
    );

    const programUsdcBefore = Number(
      (await getAccount(connection, programUsdcAccount.address)).amount
    );

    const [foundersPoolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founders_pool')],
      program.programId
    );

    const [founderPoolTokenAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founder_pool_token_account'), usdcMint.toBuffer()],
      program.programId
    );

    const [founderAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founder_authority')],
      program.programId
    );

    const founderPoolTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      founderAuthorityPda,
      true
    );

    const tx = await program.methods
      .sellToken(new anchor.BN(secondUserTokenBefore))
      .accounts({
        user: secondUser.publicKey,
        userState: secondUserStatePda,
        userTokenAccount: secondUserUpTokenAccount.address,
        userUsdcAccount: secondUserUsdcAccount,
        deployerUsdcAccount: usdcTokenAccount,
        programPaymentTokenAccount: programUsdcAccount.address,
        metadata: metadataPda,
        tokenMint: upOnlyMint,
        mintAuthority: PublicKey.default, // unused but required
        founderPoolTokenAccount: founderPoolTokenAccount.address,
        foundersPool: foundersPoolPda,
        poolAuthority,
        referralUsdcAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([secondUser])
      .rpc();

    const secondUserTokenAfter = Number(
      (await getAccount(connection, secondUserUpTokenAccount.address)).amount
    );
    const secondUserUsdcAfter = Number(
      (await getAccount(connection, secondUserUsdcAccount)).amount
    );
    const referralUsdcAfter = Number((await getAccount(connection, referralUsdcAccount)).amount);
    const deployerUsdcAfter = Number((await getAccount(connection, usdcTokenAccount)).amount);
    const programUsdcAfter = Number(
      (await getAccount(connection, programUsdcAccount.address)).amount
    );

    console.log('👤 Second user USDC before:', secondUserUsdcBefore / 1e6);
    console.log('👤 Second user USDC after:', secondUserUsdcAfter / 1e6);
    console.log('🤝 Referral USDC before:', referralUsdcBefore / 1e6);
    console.log('🤝 Referral USDC after:', referralUsdcAfter / 1e6);
    console.log('💼 Deployer USDC before:', deployerUsdcBefore / 1e6);
    console.log('💼 Deployer USDC after:', deployerUsdcAfter / 1e6);
    console.log('📉 Tokens before:', secondUserTokenBefore / 1e9);
    console.log('📉 Tokens after:', secondUserTokenAfter / 1e9);
    console.log('🏦 Program USDC before:', programUsdcBefore / 1e6);
    console.log('🏦 Program USDC after:', programUsdcAfter / 1e6);

    const mintInfo = await getMint(connection, upOnlyMint);
    console.log('🧾 Total token supply after sell:', Number(mintInfo.supply) / 1e9);

    assert.equal(secondUserTokenAfter, 0, 'All tokens should be sold');
    assert.isAbove(secondUserUsdcAfter, secondUserUsdcBefore, 'User should receive USDC');
    assert.isAbove(referralUsdcAfter, referralUsdcBefore, 'Referral should receive 2.5%');
    assert.isAbove(deployerUsdcAfter, deployerUsdcBefore, 'Deployer should receive 2.5%');
  });

  it.skip('Buyer buys tokens AGAIN', async () => {
    const [userStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('user_state'), buyer.publicKey.toBuffer()],
      program.programId
    );

    const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('mint_authority')],
      program.programId
    );

    const buyerUpTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      upOnlyMint,
      buyer.publicKey
    );

    const lockedLiquidityAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      wallet.publicKey
    );

    const deployerUsdcAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      wallet.publicKey
    );

    const buyerStart = Number((await getAccount(connection, buyerUsdcAccount)).amount);
    const buyerBalance = await getAccount(connection, buyerUsdcAccount);
    console.log('Buyer USDC balance:', Number(buyerBalance.amount));

    const [programUsdcTokenAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('token_account'), usdcMint.toBuffer()],
      program.programId
    );

    const programUsdcAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      programUsdcTokenAccountPda,
      true
    );

    const programUsdcBefore = Number(
      (await getAccount(connection, programUsdcAccount.address)).amount
    );

    const [programUpOnlyTokenAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('token_account'), upOnlyMint.toBuffer()],
      program.programId
    );

    const programUpOnlyAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      upOnlyMint,
      programUpOnlyTokenAccountPda,
      true
    );

    const tokenBalanceBefore = Number(
      (await getAccount(connection, buyerUpTokenAccount.address)).amount
    );
    const [foundersPoolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founders_pool')],
      program.programId
    );

    const [founderPoolTokenAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founder_pool_token_account'), usdcMint.toBuffer()],
      program.programId
    );
    const [founderAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founder_authority')],
      program.programId
    );

    const founderPoolTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      founderAuthorityPda,
      true
    );

    const tx = await program.methods
      .buyToken(new anchor.BN(1_000_000_000), null) // 1000 USDC
      .accounts({
        user: buyer.publicKey,
        userState: userStatePda,
        userUsdcAccount: buyerUsdcAccount,
        userTokenAccount: buyerUpTokenAccount.address,
        deployerUsdcAccount: deployerUsdcAccount.address,
        lockedLiquidityUsdc: lockedLiquidityAccount.address,
        programPaymentTokenAccount: programUsdcAccount.address,
        metadata: metadataPda,
        tokenMint: upOnlyMint,
        mintAuthority: mintAuthorityPda,
        founderPoolTokenAccount: founderPoolTokenAccount.address,
        foundersPool: foundersPoolPda,
        referralUsdcAccount: null,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([buyer])
      .rpc();

    console.log('Buy token tx:', tx);

    const buyerEnd = Number((await getAccount(connection, buyerUsdcAccount)).amount);
    const tokenBalanceAfter = Number(
      (await getAccount(connection, buyerUpTokenAccount.address)).amount
    );

    const programUsdcAfter = Number(
      (await getAccount(connection, programUsdcAccount.address)).amount
    );

    const usdcSpent = buyerStart - buyerEnd;
    const tokensReceived = tokenBalanceAfter - tokenBalanceBefore;

    const avgPricePaid = usdcSpent / 1e6 / (tokensReceived / 1e9);
    console.log('💸 Average price paid this buy:', avgPricePaid.toFixed(6));

    console.log('buyerStart', buyerStart);
    console.log('Buyer USDC balance:', buyerEnd);
    console.log('tokenBalanceBefore', tokenBalanceBefore);
    console.log('tokenBalance:', tokenBalanceAfter);
    console.log('programUsdcBefore', programUsdcBefore);
    console.log('programUsdcAfter', programUsdcAfter);

    const mintInfo = await getMint(connection, upOnlyMint);
    console.log('🧾 Total token supply:', Number(mintInfo.supply) / 1e9);

    assert.equal(buyerStart - buyerEnd, 1_000_000_000, 'Buyer should have spent 1000 USDC');
    assert.isAbove(tokenBalanceAfter, 0, 'Buyer should have received tokens');
  });

  it('Initializes vault for lockedUser', async () => {
    const [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), lockedUser.publicKey.toBuffer()],
      program.programId
    );

    const vaultTokenAccount = await getAssociatedTokenAddress(upOnlyMint, vaultAuthorityPda, true);

    await program.methods
      .initializeUserVault()
      .accounts({
        user: lockedUser.publicKey,
        vaultAuthority: vaultAuthorityPda,
        vaultTokenAccount: vaultTokenAccount,
        tokenMint: upOnlyMint,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([lockedUser])
      .rpc();

    const accountInfo = await getAccount(connection, vaultTokenAccount);
    assert.equal(
      accountInfo.owner.toBase58(),
      vaultAuthorityPda.toBase58(),
      'Vault ATA owner mismatch'
    );
  });

  it('User buys and locks tokens without a pass', async () => {
    const lockedUserUsdcAccount = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        wallet.payer,
        usdcMint,
        lockedUser.publicKey
      )
    ).address;

    const [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), lockedUser.publicKey.toBuffer()],
      program.programId
    );

    const vaultTokenAccount = await getAssociatedTokenAddress(upOnlyMint, vaultAuthorityPda, true);

    const [lockStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('locked'), lockedUser.publicKey.toBuffer()],
      program.programId
    );

    const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('mint_authority')],
      program.programId
    );

    const [programUsdcTokenAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('token_account'), usdcMint.toBuffer()],
      program.programId
    );

    const programUsdcAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      programUsdcTokenAccountPda,
      true
    );

    const tokenBalanceBefore = Number((await getAccount(connection, vaultTokenAccount)).amount);

    const [foundersPoolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founders_pool')],
      program.programId
    );

    const [founderAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founder_authority')],
      program.programId
    );

    const founderPoolTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      founderAuthorityPda,
      true
    );

    const tx = await program.methods
      .buyAndLockToken(new anchor.BN(1_000_000_000), new anchor.BN(0), null)
      .accounts({
        user: lockedUser.publicKey,
        lockState: lockStatePda,
        userUsdcAccount: lockedUserUsdcAccount,
        deployerUsdcAccount: usdcTokenAccount,
        programPaymentTokenAccount: programUsdcAccount.address,
        tokenMint: upOnlyMint,
        vaultTokenAccount: vaultTokenAccount,
        vaultAuthority: vaultAuthorityPda,
        mintAuthority: mintAuthorityPda,
        metadata: metadataPda,
        referralUsdcAccount: null,
        founderPoolTokenAccount: founderPoolTokenAccount.address,
        foundersPool: foundersPoolPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([lockedUser])
      .rpc();

    console.log('Is Done');
    const lockedState = await program.account.lockedTokenState.fetch(lockStatePda);
    console.log('🔒 Locked amount:', lockedState.amount / 1e9);
    console.log(
      '🔓 Unlock time:',
      new Date(lockedState.unlockTime.toNumber() * 1000).toUTCString()
    );

    const tokenBalanceAfter = Number((await getAccount(connection, vaultTokenAccount)).amount);

    console.log('tokenBalanceBefore', tokenBalanceBefore);
    console.log('tokenBalanceAfter', tokenBalanceAfter);

    const mintInfo = await getMint(connection, upOnlyMint);
    console.log('🧾 Total token supply:', Number(mintInfo.supply) / 1e9);

    const userTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      upOnlyMint,
      lockedUser.publicKey
    );

    const userTokenBalance = Number(
      (await getAccount(connection, userTokenAccount.address)).amount
    );

    const vaultTokenBalance = Number((await getAccount(connection, vaultTokenAccount)).amount);

    console.log('🔐 Vault Token Account Balance:', vaultTokenBalance / 1e9);
    console.log('🙅 User Token Account Balance:', userTokenBalance / 1e9);

    assert.equal(userTokenBalance, 0, 'User should NOT receive tokens directly');
    assert.equal(vaultTokenBalance, lockedState.amount, 'Vault should contain the locked tokens');

    assert.equal(lockedState.user.toBase58(), lockedUser.publicKey.toBase58(), 'User must match');
    assert.isAbove(Number(lockedState.amount), 0, 'Tokens must be locked');
    assert.isAbove(
      lockedState.unlockTime.toNumber(),
      Date.now() / 1000,
      'Unlock time must be in the future'
    );
  });

  it('Fails to initialize vault again for lockedUser', async () => {
    const [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), lockedUser.publicKey.toBuffer()],
      program.programId
    );

    const vaultTokenAccount = await getAssociatedTokenAddress(upOnlyMint, vaultAuthorityPda, true);

    let failed = false;
    try {
      await program.methods
        .initializeUserVault()
        .accounts({
          user: lockedUser.publicKey,
          vaultAuthority: vaultAuthorityPda,
          vaultTokenAccount: vaultTokenAccount,
          tokenMint: upOnlyMint,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([lockedUser])
        .rpc();
    } catch (e) {
      failed = true;
      console.log('✅ Second vault init failed as expected');
    }

    assert.isTrue(failed, 'Second vault initialization should fail');
  });

  it('Fails to buy and lock tokens again for the same user', async () => {
    const [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), lockedUser.publicKey.toBuffer()],
      program.programId
    );

    const vaultTokenAccount = await getAssociatedTokenAddress(upOnlyMint, vaultAuthorityPda, true);

    const lockedUserUsdcAccount = await getAssociatedTokenAddress(usdcMint, lockedUser.publicKey);

    const [lockStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('locked'), lockedUser.publicKey.toBuffer()],
      program.programId
    );

    const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('mint_authority')],
      program.programId
    );

    const [programUsdcTokenAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('token_account'), usdcMint.toBuffer()],
      program.programId
    );

    const programUsdcAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      programUsdcTokenAccountPda,
      true
    );

    const [foundersPoolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founders_pool')],
      program.programId
    );

    const [founderAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founder_authority')],
      program.programId
    );

    const founderPoolTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      founderAuthorityPda,
      true
    );

    let failed = false;
    try {
      await program.methods
        .buyAndLockToken(new anchor.BN(1_000_000_000), new anchor.BN(7), null) // 1000 USDC, lock 7 days again
        .accounts({
          user: lockedUser.publicKey,
          lockState: lockStatePda,
          userUsdcAccount: lockedUserUsdcAccount,
          deployerUsdcAccount: usdcTokenAccount,
          programPaymentTokenAccount: programUsdcAccount.address,
          tokenMint: upOnlyMint,
          vaultTokenAccount: vaultTokenAccount,
          vaultAuthority: vaultAuthorityPda,
          mintAuthority: mintAuthorityPda,
          metadata: metadataPda,
          referralUsdcAccount: null,
          founderPoolTokenAccount: founderPoolTokenAccount.address,
          foundersPool: foundersPoolPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([lockedUser])
        .rpc();
    } catch (e) {
      failed = true;
      console.log('✅ Second lock attempt correctly failed');
    }

    assert.isTrue(failed, 'Second buyAndLockToken should fail due to AlreadyInitialized');
  });

  it('User unlocks early with penalty using earlyUnlockTokens()', async () => {
    const [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), lockedUser.publicKey.toBuffer()],
      program.programId
    );

    const vaultTokenAccount = await getAssociatedTokenAddress(upOnlyMint, vaultAuthorityPda, true);

    const [lockStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('locked'), lockedUser.publicKey.toBuffer()],
      program.programId
    );

    const [programUsdcTokenAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('token_account'), usdcMint.toBuffer()],
      program.programId
    );

    const programUsdcAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      programUsdcTokenAccountPda,
      true
    );

    const [foundersPoolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founders_pool')],
      program.programId
    );

    const [founderAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founder_authority')],
      program.programId
    );

    const founderPoolTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      founderAuthorityPda,
      true
    );

    const lockedUserUsdcAccount = await getAssociatedTokenAddress(usdcMint, lockedUser.publicKey);

    const before = Number((await getAccount(connection, lockedUserUsdcAccount)).amount);
    const founderBefore = Number(
      (await getAccount(connection, founderPoolTokenAccount.address)).amount
    );
    const deployerBefore = Number((await getAccount(connection, usdcTokenAccount)).amount);

    const [poolAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('token_account'), usdcMint.toBuffer()],
      program.programId
    );

    const liquidityBefore = Number(
      (await getAccount(connection, programUsdcAccount.address)).amount
    );

    const mintBefore = await connection.getParsedAccountInfo(upOnlyMint);
    const tokenSupplyBefore = Number(mintBefore.value?.data?.parsed?.info?.supply ?? 0);

    const tx = await program.methods
      .earlyUnlockTokens()
      .accounts({
        cranker: lockedUser.publicKey, // not used, reuse context
        user: lockedUser.publicKey,
        lockState: lockStatePda,
        vaultAuthority: vaultAuthorityPda,
        vaultTokenAccount: vaultTokenAccount,
        userUsdcAccount: lockedUserUsdcAccount,
        deployerUsdcAccount: usdcTokenAccount,
        programPaymentTokenAccount: programUsdcAccount.address,
        tokenMint: upOnlyMint,
        metadata: metadataPda,
        poolAuthority: poolAuthorityPda,
        founderPoolTokenAccount: founderPoolTokenAccount.address,
        foundersPool: foundersPoolPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([lockedUser])
      .rpc();

    const after = Number((await getAccount(connection, lockedUserUsdcAccount)).amount);
    const founderPoolBalance = await getAccount(connection, founderPoolTokenAccount.address);
    const deployerBalance = await getAccount(connection, usdcTokenAccount);
    const liquidityAfter = Number(
      (await getAccount(connection, programUsdcAccount.address)).amount
    );

    const mintAfter = await connection.getParsedAccountInfo(upOnlyMint);
    const tokenSupplyAfter = Number(mintAfter.value?.data?.parsed?.info?.supply ?? 0);

    console.log('📦 Token Supply (before):', tokenSupplyBefore / 1e9);
    console.log('📦 Token Supply (after):', tokenSupplyAfter / 1e9);
    console.log('🔥 Tokens Burned:', (tokenSupplyBefore - tokenSupplyAfter) / 1e9);

    console.log('🏦 Liquidity USDC (before):', liquidityBefore / 1e6);
    console.log('🏦 Liquidity USDC (after):', liquidityAfter / 1e6);
    console.log('🔻 Liquidity Removed:', (liquidityBefore - liquidityAfter) / 1e6);

    console.log('📊 Final Balances:');
    console.log('  • 🧑‍💼 User USDC:', after / 1e6);
    console.log('  • 🏦 Founder Pool USDC:', Number(founderPoolBalance.amount) / 1e6);
    console.log('  • 💼 Deployer USDC:', Number(deployerBalance.amount) / 1e6);

    console.log('💰 Breakdown:');
    console.log('  • 📈 Profit to User:', (after - before) / 1e6);
    console.log(
      '  • 💸 Gain to Founder Pool:',
      (Number(founderPoolBalance.amount) - founderBefore) / 1e6
    );
    console.log('  • 🏷️ Fee to Deployer:', (Number(deployerBalance.amount) - deployerBefore) / 1e6);

    assert.isAbove(after, before, 'User should receive USDC after early unlock');
  });

  it('Cranker fails to call earlyUnlockTokens() on someone else’s lock', async () => {
    const crank = Keypair.generate();
    await connection.requestAirdrop(crank.publicKey, 2e9);

    const [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), lockedUser.publicKey.toBuffer()],
      program.programId
    );

    const vaultTokenAccount = await getAssociatedTokenAddress(upOnlyMint, vaultAuthorityPda, true);

    const [lockStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('locked'), lockedUser.publicKey.toBuffer()],
      program.programId
    );

    const [programUsdcTokenAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('token_account'), usdcMint.toBuffer()],
      program.programId
    );

    const programUsdcAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      programUsdcTokenAccountPda,
      true
    );

    const [foundersPoolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founders_pool')],
      program.programId
    );

    const [founderAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founder_authority')],
      program.programId
    );

    const founderPoolTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      founderAuthorityPda,
      true
    );

    const lockedUserUsdcAccount = await getAssociatedTokenAddress(usdcMint, lockedUser.publicKey);

    const [poolAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('token_account'), usdcMint.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .earlyUnlockTokens()
        .accounts({
          user: lockedUser.publicKey,
          lockState: lockStatePda,
          vaultAuthority: vaultAuthorityPda,
          vaultTokenAccount: vaultTokenAccount,
          userUsdcAccount: lockedUserUsdcAccount,
          deployerUsdcAccount: usdcTokenAccount,
          programPaymentTokenAccount: programUsdcAccount.address,
          tokenMint: upOnlyMint,
          metadata: metadataPda,
          poolAuthority: poolAuthorityPda,
          founderPoolTokenAccount: founderPoolTokenAccount.address,
          foundersPool: foundersPoolPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([crank])
        .rpc();

      assert.fail('Cranker was able to call earlyUnlockTokens, but should not be allowed');
    } catch (err: any) {
      const errMsg = err.toString();
      console.log('❌ Expected failure:', errMsg);
      assert(
        errMsg.includes('signature verification failed') ||
          errMsg.includes('unknown signer') ||
          errMsg.includes('unauthorized'),
        'Expected signer rejection or unauthorized error'
      );
    }
  });

  it('Cranker (bot) claims unlocked tokens and sends USDC to the locked user', async () => {
    const crank = Keypair.generate();

    // Airdrop SOL to the cranker for tx fees
    await connection.requestAirdrop(crank.publicKey, 2e9);

    const [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), lockedUser.publicKey.toBuffer()],
      program.programId
    );

    const vaultTokenAccount = await getAssociatedTokenAddress(upOnlyMint, vaultAuthorityPda, true);

    const [lockStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('locked'), lockedUser.publicKey.toBuffer()],
      program.programId
    );

    const [programUsdcTokenAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('token_account'), usdcMint.toBuffer()],
      program.programId
    );

    const programUsdcAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      programUsdcTokenAccountPda,
      true
    );

    const [foundersPoolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founders_pool')],
      program.programId
    );

    const [founderAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founder_authority')],
      program.programId
    );

    const founderPoolTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      founderAuthorityPda,
      true
    );

    const lockedUserUsdcAccount = await getAssociatedTokenAddress(usdcMint, lockedUser.publicKey);

    const before = Number((await getAccount(connection, lockedUserUsdcAccount)).amount);
    const founderBefore = Number(
      (await getAccount(connection, founderPoolTokenAccount.address)).amount
    );
    const deployerBefore = Number((await getAccount(connection, usdcTokenAccount)).amount);
    const crankerUsdcAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      crank.publicKey
    );
    const crankerBefore = Number((await getAccount(connection, crankerUsdcAccount.address)).amount);

    await new Promise(resolve => setTimeout(resolve, 2000)); // wait 2s for unlock to be valid

    const [poolAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('token_account'), usdcMint.toBuffer()],
      program.programId
    );

    const liquidityBefore = Number(
      (await getAccount(connection, programUsdcAccount.address)).amount
    );
    const mintBefore = await connection.getParsedAccountInfo(upOnlyMint);
    const tokenSupplyBefore = mintBefore.value?.data?.parsed?.info?.supply
      ? Number(mintBefore.value.data.parsed.info.supply)
      : 0;

    const tx = await program.methods
      .claimLockedTokens()
      .accounts({
        cranker: crank.publicKey,
        user: lockedUser.publicKey,
        lockState: lockStatePda,
        vaultAuthority: vaultAuthorityPda,
        vaultTokenAccount: vaultTokenAccount,
        userUsdcAccount: lockedUserUsdcAccount,
        deployerUsdcAccount: usdcTokenAccount,
        programPaymentTokenAccount: programUsdcAccount.address,
        tokenMint: upOnlyMint,
        metadata: metadataPda,
        poolAuthority: poolAuthorityPda,
        founderPoolTokenAccount: founderPoolTokenAccount.address,
        foundersPool: foundersPoolPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([crank])
      .rpc();

    const founderPoolBalance = await getAccount(connection, founderPoolTokenAccount.address);
    const deployerBalance = await getAccount(connection, usdcTokenAccount);
    const crankerAfter = Number((await getAccount(connection, crankerUsdcAccount.address)).amount);
    const liquidityAfter = Number(
      (await getAccount(connection, programUsdcAccount.address)).amount
    );

    const mintAfter = await connection.getParsedAccountInfo(upOnlyMint);
    const tokenSupplyAfter = mintAfter.value?.data?.parsed?.info?.supply
      ? Number(mintAfter.value.data.parsed.info.supply)
      : 0;

    console.log('📦 Token Supply (before):', tokenSupplyBefore / 1e9);
    console.log('📦 Token Supply (after):', tokenSupplyAfter / 1e9);
    console.log('🔥 Tokens Burned:', (tokenSupplyBefore - tokenSupplyAfter) / 1e9);

    console.log('🏦 Liquidity USDC (before):', liquidityBefore / 1e6);
    console.log('🏦 Liquidity USDC (after):', liquidityAfter / 1e6);
    console.log('🔻 Liquidity Removed:', (liquidityBefore - liquidityAfter) / 1e6);

    const after = Number((await getAccount(connection, lockedUserUsdcAccount)).amount);
    console.log('📊 Final Balances:');
    console.log('  • 🧑‍💼 User USDC:', after / 1e6);
    console.log('  • 🏦 Founder Pool USDC:', Number(founderPoolBalance.amount) / 1e6);
    console.log('  • 💼 Deployer USDC:', Number(deployerBalance.amount) / 1e6);

    console.log('💰 Breakdown:');
    console.log('  • 📈 Profit to User:', (after - before) / 1e6);
    console.log(
      '  • 💸 Gain to Founder Pool:',
      (Number(founderPoolBalance.amount) - founderBefore) / 1e6
    );
    console.log('  • 🏷️ Fee to Deployer:', (Number(deployerBalance.amount) - deployerBefore) / 1e6);

    console.log('  • 🤖 Cranker USDC (before):', crankerBefore / 1e6);
    console.log('  • 🤖 Cranker USDC (after):', crankerAfter / 1e6);
    console.log('  • 💸 Cranker Reward (USDC):', (crankerAfter - crankerBefore) / 1e6);

    assert.isAbove(after, before, 'User should receive USDC after locked token claim');
  });

  it.skip('Founder claims their share after buys and sells', async () => {
    const [foundersPoolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founders_pool')],
      program.programId
    );

    const [founderAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founder_authority')],
      program.programId
    );

    const founderTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      referral.publicKey
    );

    const [founderPoolTokenAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founder_pool_token_account'), usdcMint.toBuffer()],
      program.programId
    );

    const founderPoolTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      founderAuthorityPda,
      true
    );

    const before = Number((await getAccount(connection, founderTokenAccount.address)).amount);
    const founderPoolInfo = await getAccount(connection, founderPoolTokenAccount.address);
    console.log('Founder Pool Token Account Balance:', Number(founderPoolInfo.amount) / 1e6);
    const pool = await program.account.foundersPool.fetch(foundersPoolPda);
    console.log('Total collected:', Number(pool.totalCollected) / 1e6);
    console.log('Per founder:', Number(pool.totalCollected / 60) / 1e6);

    const tx = await program.methods
      .claimFounderShare()
      .accounts({
        founder: referral.publicKey,
        foundersPool: foundersPoolPda,
        founderTokenAccount: founderTokenAccount.address,
        founderPoolTokenAccount: founderPoolTokenAccount.address,
        founderAuthority: founderAuthorityPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([referral])
      .rpc();

    console.log('✅ Founder claimed share, tx:', tx);

    const after = Number((await getAccount(connection, founderTokenAccount.address)).amount);
    const claimed = after - before;
    const founderPoolInfoAfter = await getAccount(connection, founderPoolTokenAccount.address);
    console.log('Founder Pool Token Account Balance:', Number(founderPoolInfoAfter.amount) / 1e6);
    console.log('💰 Claimed USDC:', claimed / 1e6);

    assert.isAbove(claimed, 0, 'Founder should have received some USDC');
  });

  it.skip('Second founder claims their share after buys and sells', async () => {
    const [foundersPoolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founders_pool')],
      program.programId
    );

    const [founderAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founder_authority')],
      program.programId
    );

    const founderTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      secondUser.publicKey
    );

    const [founderPoolTokenAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('founder_pool_token_account'), usdcMint.toBuffer()],
      program.programId
    );

    const founderPoolTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      usdcMint,
      founderAuthorityPda,
      true
    );

    const before = Number((await getAccount(connection, founderTokenAccount.address)).amount);
    const founderPoolInfo = await getAccount(connection, founderPoolTokenAccount.address);
    console.log('Founder Pool Token Account Balance:', Number(founderPoolInfo.amount) / 1e6);
    const pool = await program.account.foundersPool.fetch(foundersPoolPda);
    console.log('Total collected:', Number(pool.totalCollected) / 1e6);
    console.log('Per founder:', Number(pool.totalCollected / 60) / 1e6);

    const tx = await program.methods
      .claimFounderShare()
      .accounts({
        founder: secondUser.publicKey,
        foundersPool: foundersPoolPda,
        founderTokenAccount: founderTokenAccount.address,
        founderPoolTokenAccount: founderPoolTokenAccount.address,
        founderAuthority: founderAuthorityPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([secondUser])
      .rpc();

    console.log('✅ Second founder claimed share, tx:', tx);

    const after = Number((await getAccount(connection, founderTokenAccount.address)).amount);
    const claimed = after - before;
    const founderPoolInfoAfter = await getAccount(connection, founderPoolTokenAccount.address);
    console.log('Founder Pool Token Account Balance:', Number(founderPoolInfoAfter.amount) / 1e6);
    console.log('💰 Claimed USDC:', claimed / 1e6);

    assert.isAbove(claimed, 0, 'Second founder should have received some USDC');
  });
});
