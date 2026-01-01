/**
 * Solana Stealth Addresses SDK
 * 
 * Fluidkey-style stealth addresses for Solana.
 * Privacy-preserving payments without smart contracts.
 * 
 * @example
 * ```typescript
 * import { StealthAccount, StealthPayment, StealthScanner } from '@solana-stealth/sdk';
 * 
 * // Alice generates her stealth identity
 * const alice = new StealthAccount();
 * console.log("Alice's payment address:", alice.getMetaAddressString());
 * // Output: st:sol:ABC123...
 * 
 * // Bob sends to Alice
 * const payment = StealthPayment.create(alice.getMetaAddressString());
 * await payment.send(connection, bob, 1_000_000_000); // 1 SOL
 * 
 * // Alice scans and receives
 * const scanner = new StealthScanner(alice, connection);
 * const received = await scanner.scanAnnouncements(announcements);
 * for (const p of received) {
 *   console.log(`Found ${p.balance} lamports at ${p.stealthAddress}`);
 *   await scanner.withdraw(p, aliceMainWallet);
 * }
 * ```
 * 
 * @packageDocumentation
 */

// Core types
export type {
  StealthMetaAddress,
  StealthKeys,
  StealthAddressResult,
} from './crypto';

// Core cryptographic functions
export {
  generateStealthKeys,
  computeStealthAddress,
  deriveStealthKeypair,
  checkViewTag,
  computeExpectedStealthAddress,
  extractScalar,
} from './crypto';

// Encoding/decoding
export {
  encodeMetaAddress,
  decodeMetaAddress,
  isValidMetaAddress,
  createPaymentLink,
  parsePaymentLink,
} from './encoding';

// High-level SDK
export {
  StealthAccount,
  StealthPayment,
  StealthScanner,
  StealthAnnouncement,
  DiscoveredPayment,
  serializeAnnouncement,
  deserializeAnnouncement,
  sendStealth,
  generateMetaAddress,
} from './sdk';
