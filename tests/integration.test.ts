/**
 * Integration Test - Full Stealth Payment Flow on Devnet
 * 
 * This test performs an actual stealth transfer on Solana devnet.
 * 
 * Run with: npx ts-node tests/integration.test.ts
 * 
 * Note: Requires devnet SOL. Use `solana airdrop 2` to get test SOL.
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
  sendAndConfirmTransaction,
  Transaction,
  SystemProgram,
} from '@solana/web3.js';

import {
  StealthAccount,
  StealthPayment,
  StealthScanner,
} from '../src';

const DEVNET_URL = clusterApiUrl('devnet');

async function airdrop(connection: Connection, pubkey: any, sol: number = 1) {
  console.log(`Requesting ${sol} SOL airdrop...`);
  const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig);
  console.log('Airdrop confirmed');
}

async function main() {
  const connection = new Connection(DEVNET_URL, 'confirmed');
  
  console.log('='.repeat(60));
  console.log('Stealth Address Integration Test');
  console.log('='.repeat(60));
  
  // Create sender (Bob)
  const bob = Keypair.generate();
  console.log('\nBob (sender):', bob.publicKey.toBase58());
  
  // Airdrop to Bob
  await airdrop(connection, bob.publicKey, 2);
  
  // Create recipient (Alice) stealth account
  const alice = new StealthAccount();
  console.log('\nAlice (recipient) meta-address:', alice.getMetaAddressString());
  
  // Bob creates stealth payment
  console.log('\n[1] Bob computes stealth address for Alice...');
  const payment = StealthPayment.create(alice.getMetaAddress());
  console.log('Stealth address:', payment.stealthAddress.toBase58());
  
  // Check initial balance
  const initialBalance = await connection.getBalance(payment.stealthAddress);
  console.log('Initial stealth balance:', initialBalance / LAMPORTS_PER_SOL, 'SOL');
  
  // Bob sends SOL to stealth address
  console.log('\n[2] Bob sends 0.1 SOL to stealth address...');
  const amountToSend = 0.1 * LAMPORTS_PER_SOL;
  
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: bob.publicKey,
      toPubkey: payment.stealthAddress,
      lamports: amountToSend,
    })
  );
  
  const sig = await sendAndConfirmTransaction(connection, tx, [bob]);
  console.log('Transaction:', sig);
  
  // Verify balance
  const stealthBalance = await connection.getBalance(payment.stealthAddress);
  console.log('Stealth address balance:', stealthBalance / LAMPORTS_PER_SOL, 'SOL');
  
  // Alice discovers the payment
  console.log('\n[3] Alice scans for payments...');
  const announcement = payment.getAnnouncement();
  
  // Check view tag
  const viewTagMatches = alice.checkViewTag(
    announcement.ephemeralPubkey,
    announcement.viewTag
  );
  console.log('View tag matches:', viewTagMatches);
  
  // Verify address
  const expectedAddress = alice.computeExpectedAddress(announcement.ephemeralPubkey);
  console.log('Expected address matches:', expectedAddress.equals(announcement.stealthAddress));
  
  // Alice derives keypair
  console.log('\n[4] Alice derives spending keypair...');
  const stealthKeypair = alice.deriveKeypair(announcement.ephemeralPubkey);
  console.log('Derived pubkey:', stealthKeypair.publicKey.toBase58());
  console.log('Matches stealth address:', stealthKeypair.publicKey.equals(payment.stealthAddress));
  
  // Alice creates a fresh destination wallet
  const aliceDestination = Keypair.generate();
  console.log('\nAlice destination wallet:', aliceDestination.publicKey.toBase58());
  
  // Alice withdraws to her wallet
  console.log('\n[5] Alice withdraws to destination...');
  const withdrawAmount = stealthBalance - 5000; // Leave some for tx fee
  
  const withdrawTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: stealthKeypair.publicKey,
      toPubkey: aliceDestination.publicKey,
      lamports: withdrawAmount,
    })
  );
  
  try {
    const withdrawSig = await sendAndConfirmTransaction(
      connection,
      withdrawTx,
      [stealthKeypair]
    );
    console.log('Withdrawal transaction:', withdrawSig);
    
    // Verify final balances
    const finalStealthBalance = await connection.getBalance(payment.stealthAddress);
    const destinationBalance = await connection.getBalance(aliceDestination.publicKey);
    
    console.log('\n[6] Final balances:');
    console.log('Stealth address:', finalStealthBalance / LAMPORTS_PER_SOL, 'SOL');
    console.log('Alice destination:', destinationBalance / LAMPORTS_PER_SOL, 'SOL');
    
    console.log('\n' + '='.repeat(60));
    console.log('SUCCESS! Full stealth payment cycle completed.');
    console.log('='.repeat(60));
  } catch (err) {
    console.error('\nWithdrawal failed:', err);
    console.log('\nNote: The derived keypair signing might need adjustment.');
    console.log('This is the tricky part of Ed25519 key derivation.');
    
    // Debug info
    console.log('\nDebug info:');
    console.log('Stealth pubkey from payment:', payment.stealthAddress.toBase58());
    console.log('Derived pubkey:', stealthKeypair.publicKey.toBase58());
    console.log('Match:', payment.stealthAddress.equals(stealthKeypair.publicKey));
  }
}

main().catch(console.error);
