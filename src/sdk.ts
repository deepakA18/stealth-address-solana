/**
 * Solana Stealth Address SDK
 * 
 * High-level API for stealth addresses on Solana.
 * 
 * Usage:
 * 
 * ```typescript
 * // Alice: Generate stealth identity
 * const alice = new StealthAccount();
 * console.log("Share this:", alice.getMetaAddressString());
 * 
 * // Bob: Send to Alice's stealth address
 * const payment = StealthPayment.create(alice.getMetaAddress());
 * await payment.send(connection, bobKeypair, 1_000_000_000); // 1 SOL
 * 
 * // Alice: Scan and receive
 * const scanner = new StealthScanner(alice, connection);
 * const received = await scanner.scan();
 * for (const payment of received) {
 *   await payment.withdraw(connection, aliceWallet);
 * }
 * ```
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import bs58 from 'bs58';

import {
  StealthMetaAddress,
  StealthKeys,
  StealthAddressResult,
  generateStealthKeys,
  computeStealthAddress,
  deriveStealthKeypair,
  checkViewTag,
  computeExpectedStealthAddress,
  extractScalar,
} from './crypto';

import {
  encodeMetaAddress,
  decodeMetaAddress,
  isValidMetaAddress,
} from './encoding';

// Re-export types and utilities
export {
  StealthMetaAddress,
  StealthKeys,
  StealthAddressResult,
  encodeMetaAddress,
  decodeMetaAddress,
  isValidMetaAddress,
};

// Memo program ID for announcements
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

/**
 * Announcement stored on-chain (via memo) or off-chain
 */
export interface StealthAnnouncement {
  /** Ephemeral public key (32 bytes) */
  ephemeralPubkey: Uint8Array;
  
  /** View tag for fast filtering */
  viewTag: number;
  
  /** The stealth address that received funds */
  stealthAddress: PublicKey;
  
  /** Transaction signature where this was announced */
  txSignature?: string;
  
  /** Slot number of the announcement */
  slot?: number;
}

/**
 * A discovered payment that can be spent
 */
export interface DiscoveredPayment {
  /** The stealth address holding the funds */
  stealthAddress: PublicKey;
  
  /** Ephemeral pubkey from announcement */
  ephemeralPubkey: Uint8Array;
  
  /** Balance in lamports */
  balance: number;
  
  /** The keypair to spend these funds (derived) */
  keypair: Keypair;
}

// ============================================================================
// STEALTH ACCOUNT
// ============================================================================

/**
 * A stealth account represents a user's stealth identity.
 * 
 * It contains the viewing and spending keys needed to:
 * - Generate a meta-address for receiving payments
 * - Scan for incoming payments
 * - Spend from stealth addresses
 */
export class StealthAccount {
  private keys: StealthKeys;
  
  /**
   * Create a new stealth account with fresh keys.
   */
  constructor();
  
  /**
   * Create a stealth account from existing keys.
   */
  constructor(keys: StealthKeys);
  
  /**
   * Import a stealth account from serialized format.
   */
  constructor(serialized: string);
  
  constructor(arg?: StealthKeys | string) {
    if (!arg) {
      // Generate new keys
      this.keys = generateStealthKeys();
    } else if (typeof arg === 'string') {
      // Deserialize
      this.keys = this.deserialize(arg);
    } else {
      // Use provided keys
      this.keys = arg;
    }
  }
  
  /**
   * Get the stealth meta-address (for sharing with senders).
   */
  getMetaAddress(): StealthMetaAddress {
    return this.keys.metaAddress;
  }
  
  /**
   * Get the meta-address as a shareable string.
   */
  getMetaAddressString(): string {
    return encodeMetaAddress(this.keys.metaAddress);
  }
  
  /**
   * Get the viewing private key (can be shared with a scanner service).
   */
  getViewingPrivkey(): Uint8Array {
    return this.keys.viewingPrivkey;
  }
  
  /**
   * Get the spending private key (keep secret!).
   */
  getSpendingPrivkey(): Uint8Array {
    return this.keys.spendingPrivkey;
  }
  
  /**
   * Derive the keypair for a specific stealth address.
   * Used to spend funds received at that address.
   */
  deriveKeypair(ephemeralPubkey: Uint8Array): Keypair {
    return deriveStealthKeypair(
      this.keys.viewingPrivkey,
      this.keys.spendingPrivkey,
      ephemeralPubkey
    );
  }
  
  /**
   * Check if an announcement is for us (quick check using view tag).
   */
  checkViewTag(ephemeralPubkey: Uint8Array, viewTag: number): boolean {
    return checkViewTag(this.keys.viewingPrivkey, ephemeralPubkey, viewTag);
  }
  
  /**
   * Compute the expected stealth address for an ephemeral pubkey.
   */
  computeExpectedAddress(ephemeralPubkey: Uint8Array): PublicKey {
    return computeExpectedStealthAddress(
      this.keys.viewingPrivkey,
      this.keys.metaAddress.spendingPubkey,
      ephemeralPubkey
    );
  }
  
  /**
   * Serialize the account for storage (includes private keys!).
   */
  serialize(): string {
    const data = {
      viewingPrivkey: bs58.encode(this.keys.viewingPrivkey),
      spendingPrivkey: bs58.encode(this.keys.spendingPrivkey),
      viewingPubkey: bs58.encode(this.keys.metaAddress.viewingPubkey),
      spendingPubkey: bs58.encode(this.keys.metaAddress.spendingPubkey),
    };
    return JSON.stringify(data);
  }
  
  private deserialize(serialized: string): StealthKeys {
    const data = JSON.parse(serialized);
    return {
      viewingPrivkey: bs58.decode(data.viewingPrivkey),
      spendingPrivkey: bs58.decode(data.spendingPrivkey),
      metaAddress: {
        viewingPubkey: bs58.decode(data.viewingPubkey),
        spendingPubkey: bs58.decode(data.spendingPubkey),
      },
    };
  }
}

// ============================================================================
// STEALTH PAYMENT (Sender Side)
// ============================================================================

/**
 * Represents a stealth payment to be made.
 * 
 * Usage:
 * ```typescript
 * const payment = StealthPayment.create(recipientMetaAddress);
 * await payment.send(connection, senderKeypair, amount);
 * ```
 */
export class StealthPayment {
  readonly stealthAddress: PublicKey;
  readonly ephemeralPubkey: Uint8Array;
  readonly viewTag: number;
  
  private constructor(result: StealthAddressResult) {
    this.stealthAddress = result.stealthPubkey;
    this.ephemeralPubkey = result.ephemeralPubkey;
    this.viewTag = result.viewTag;
  }
  
  /**
   * Create a new stealth payment for a recipient.
   * 
   * @param recipient - Recipient's meta-address (object or string)
   */
  static create(recipient: StealthMetaAddress | string): StealthPayment {
    const meta = typeof recipient === 'string' 
      ? decodeMetaAddress(recipient) 
      : recipient;
    
    const result = computeStealthAddress(meta);
    return new StealthPayment(result);
  }
  
  /**
   * Send SOL to the stealth address and announce the payment.
   * 
   * @param connection - Solana connection
   * @param sender - Sender's keypair
   * @param lamports - Amount to send in lamports
   * @param announce - Whether to announce via memo (default: true)
   * @returns Transaction signature
   */
  async send(
    connection: Connection,
    sender: Keypair,
    lamports: number,
    announce: boolean = true
  ): Promise<string> {
    const tx = new Transaction();
    
    // Transfer SOL to stealth address
    tx.add(
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: this.stealthAddress,
        lamports,
      })
    );
    
    // Announce via memo if requested
    if (announce) {
      tx.add(this.createAnnouncementInstruction());
    }
    
    return sendAndConfirmTransaction(connection, tx, [sender]);
  }
  
  /**
   * Create the announcement instruction (memo).
   * Can be used to include in custom transactions.
   */
  createAnnouncementInstruction(): TransactionInstruction {
    const announcement: StealthAnnouncement = {
      ephemeralPubkey: this.ephemeralPubkey,
      viewTag: this.viewTag,
      stealthAddress: this.stealthAddress,
    };
    
    return new TransactionInstruction({
      keys: [],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(serializeAnnouncement(announcement)),
    });
  }
  
  /**
   * Get announcement data for off-chain storage.
   */
  getAnnouncement(): StealthAnnouncement {
    return {
      ephemeralPubkey: this.ephemeralPubkey,
      viewTag: this.viewTag,
      stealthAddress: this.stealthAddress,
    };
  }
}

// ============================================================================
// STEALTH SCANNER (Receiver Side)
// ============================================================================

/**
 * Scans for stealth payments addressed to an account.
 */
export class StealthScanner {
  private account: StealthAccount;
  private connection: Connection;
  
  constructor(account: StealthAccount, connection: Connection) {
    this.account = account;
    this.connection = connection;
  }
  
  /**
   * Scan announcements and find payments for this account.
   * 
   * @param announcements - List of announcements to scan
   * @returns Discovered payments with derived keypairs
   */
  async scanAnnouncements(
    announcements: StealthAnnouncement[]
  ): Promise<DiscoveredPayment[]> {
    const discovered: DiscoveredPayment[] = [];
    
    for (const announcement of announcements) {
      // Quick filter by view tag
      if (!this.account.checkViewTag(announcement.ephemeralPubkey, announcement.viewTag)) {
        continue;
      }
      
      // Compute expected address
      const expectedAddress = this.account.computeExpectedAddress(announcement.ephemeralPubkey);
      
      // Verify it matches the announcement
      if (!expectedAddress.equals(announcement.stealthAddress)) {
        continue;
      }
      
      // Check balance
      const balance = await this.connection.getBalance(announcement.stealthAddress);
      
      if (balance > 0) {
        // Derive the keypair for this stealth address
        const keypair = this.account.deriveKeypair(announcement.ephemeralPubkey);
        
        discovered.push({
          stealthAddress: announcement.stealthAddress,
          ephemeralPubkey: announcement.ephemeralPubkey,
          balance,
          keypair,
        });
      }
    }
    
    return discovered;
  }
  
  /**
   * Fetch announcements from on-chain memos.
   * 
   * This is a basic implementation - in production you'd want an indexer.
   * 
   * @param limit - Maximum number of transactions to scan
   * @returns Found announcements
   */
  async fetchAnnouncementsFromMemos(limit: number = 100): Promise<StealthAnnouncement[]> {
    // This would require parsing memo transactions
    // For now, return empty - in production use an indexer
    console.warn('fetchAnnouncementsFromMemos: Not implemented - use an indexer in production');
    return [];
  }
  
  /**
   * Withdraw funds from a discovered payment to a destination address.
   * 
   * @param payment - The discovered payment
   * @param destination - Where to send the funds
   * @param leaveRent - Whether to leave rent-exempt amount (default: false)
   * @returns Transaction signature
   */
  async withdraw(
    payment: DiscoveredPayment,
    destination: PublicKey,
    leaveRent: boolean = false
  ): Promise<string> {
    const rentExempt = await this.connection.getMinimumBalanceForRentExemption(0);
    const amountToSend = leaveRent 
      ? payment.balance - rentExempt 
      : payment.balance - 5000; // Leave a bit for tx fee
    
    if (amountToSend <= 0) {
      throw new Error(`Insufficient balance: ${payment.balance} lamports`);
    }
    
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payment.stealthAddress,
        toPubkey: destination,
        lamports: amountToSend,
      })
    );
    
    return sendAndConfirmTransaction(this.connection, tx, [payment.keypair]);
  }
}

// ============================================================================
// ANNOUNCEMENT SERIALIZATION
// ============================================================================

const ANNOUNCEMENT_VERSION = 1;
const ANNOUNCEMENT_TAG = 'STEALTH';

/**
 * Serialize an announcement for memo storage.
 */
export function serializeAnnouncement(announcement: StealthAnnouncement): string {
  const data = {
    v: ANNOUNCEMENT_VERSION,
    t: ANNOUNCEMENT_TAG,
    e: bs58.encode(announcement.ephemeralPubkey),
    vt: announcement.viewTag,
    s: announcement.stealthAddress.toBase58(),
  };
  return JSON.stringify(data);
}

/**
 * Deserialize an announcement from memo data.
 */
export function deserializeAnnouncement(data: string): StealthAnnouncement | null {
  try {
    const parsed = JSON.parse(data);
    
    if (parsed.t !== ANNOUNCEMENT_TAG) {
      return null;
    }
    
    return {
      ephemeralPubkey: bs58.decode(parsed.e),
      viewTag: parsed.vt,
      stealthAddress: new PublicKey(parsed.s),
    };
  } catch {
    return null;
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Quick send to a stealth address.
 * 
 * @param connection - Solana connection
 * @param sender - Sender's keypair
 * @param recipient - Recipient's meta-address string
 * @param sol - Amount in SOL
 * @returns Transaction signature
 */
export async function sendStealth(
  connection: Connection,
  sender: Keypair,
  recipient: string,
  sol: number
): Promise<string> {
  const payment = StealthPayment.create(recipient);
  return payment.send(connection, sender, sol * LAMPORTS_PER_SOL);
}

/**
 * Generate a new stealth account and return the meta-address string.
 */
export function generateMetaAddress(): { account: StealthAccount; metaAddress: string } {
  const account = new StealthAccount();
  return {
    account,
    metaAddress: account.getMetaAddressString(),
  };
}
