/**
 * Basic Stealth Transfer Example
 * 
 * This example demonstrates:
 * 1. Alice generating a stealth identity
 * 2. Bob sending SOL to Alice's stealth address
 * 3. Alice discovering and withdrawing the payment
 * 
 * Run with: npx ts-node examples/basic-transfer.ts
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} from '@solana/web3.js';

import {
  StealthAccount,
  StealthPayment,
  StealthScanner,
} from '../src';

async function main() {
  // Connect to devnet
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  
  console.log('='.repeat(60));
  console.log('Solana Stealth Address Demo');
  console.log('='.repeat(60));
  
  // ============================================================
  // STEP 1: Alice generates her stealth identity
  // ============================================================
  console.log('\n[1] Alice generates stealth identity...\n');
  
  const alice = new StealthAccount();
  const aliceMetaAddress = alice.getMetaAddressString();
  
  console.log('Alice\'s Stealth Meta-Address:');
  console.log(aliceMetaAddress);
  console.log('\n(Alice shares this publicly - on her website, social media, etc.)');
  
  // ============================================================
  // STEP 2: Bob wants to send SOL to Alice
  // ============================================================
  console.log('\n[2] Bob creates a stealth payment...\n');
  
  // Bob only has Alice's meta-address (public info)
  const payment = StealthPayment.create(aliceMetaAddress);
  
  console.log('Stealth Address (where Bob sends):', payment.stealthAddress.toBase58());
  console.log('Ephemeral Pubkey (to announce):', Buffer.from(payment.ephemeralPubkey).toString('hex').slice(0, 32) + '...');
  console.log('View Tag:', payment.viewTag);
  
  // In a real scenario, Bob would:
  // await payment.send(connection, bobKeypair, 0.1 * LAMPORTS_PER_SOL);
  console.log('\n(In production, Bob would send SOL to the stealth address)');
  
  // ============================================================
  // STEP 3: Bob announces the payment (via memo or off-chain)
  // ============================================================
  console.log('\n[3] Payment announcement...\n');
  
  const announcement = payment.getAnnouncement();
  console.log('Announcement data (would be stored on-chain or off-chain):');
  console.log(JSON.stringify({
    ephemeralPubkey: Buffer.from(announcement.ephemeralPubkey).toString('hex').slice(0, 32) + '...',
    viewTag: announcement.viewTag,
    stealthAddress: announcement.stealthAddress.toBase58(),
  }, null, 2));
  
  // ============================================================
  // STEP 4: Alice scans for payments
  // ============================================================
  console.log('\n[4] Alice scans for payments...\n');
  
  // Quick check using view tag
  const mightBeForAlice = alice.checkViewTag(
    announcement.ephemeralPubkey,
    announcement.viewTag
  );
  console.log('View tag matches:', mightBeForAlice);
  
  // Verify the address
  const expectedAddress = alice.computeExpectedAddress(announcement.ephemeralPubkey);
  const isForAlice = expectedAddress.equals(announcement.stealthAddress);
  console.log('Address verification:', isForAlice ? '✓ Payment is for Alice!' : '✗ Not for Alice');
  
  // ============================================================
  // STEP 5: Alice derives the keypair and can spend
  // ============================================================
  console.log('\n[5] Alice derives spending keypair...\n');
  
  const stealthKeypair = alice.deriveKeypair(announcement.ephemeralPubkey);
  
  console.log('Derived keypair public key:', stealthKeypair.publicKey.toBase58());
  console.log('Matches stealth address:', stealthKeypair.publicKey.equals(announcement.stealthAddress));
  
  console.log('\nAlice can now sign transactions with this keypair!');
  console.log('The funds at', announcement.stealthAddress.toBase58(), 'are spendable.');
  
  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log(`
What just happened:

1. Alice created a stealth identity (one-time setup)
   - Generated viewing + spending keypairs
   - Published meta-address (st:sol:...)

2. Bob sent to Alice without knowing her real address
   - Computed one-time stealth address from meta-address
   - Sent SOL to that address
   - Announced ephemeral pubkey

3. Alice discovered the payment
   - Scanned announcements using viewing key
   - Found payment meant for her

4. Alice can spend the funds
   - Derived private key for the stealth address
   - Can sign transactions normally

Privacy guarantees:
- Bob doesn't know Alice's real address
- Outside observers can't link the stealth address to Alice
- Each payment goes to a unique address
- Only Alice can derive the spending key
`);
}

main().catch(console.error);
