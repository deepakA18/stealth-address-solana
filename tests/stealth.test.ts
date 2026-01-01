/**
 * Tests for Stealth Address SDK
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

import {
  generateStealthKeys,
  computeStealthAddress,
  deriveStealthKeypair,
  checkViewTag,
  computeExpectedStealthAddress,
  encodeMetaAddress,
  decodeMetaAddress,
  isValidMetaAddress,
  StealthAccount,
  StealthPayment,
  serializeAnnouncement,
  deserializeAnnouncement,
} from '../src';

import { computeStealthAddressInternal } from '../src/crypto';

describe('Stealth Address Crypto', () => {
  describe('generateStealthKeys', () => {
    it('should generate valid keys', () => {
      const keys = generateStealthKeys();
      
      expect(keys.viewingPrivkey).toHaveLength(32);
      expect(keys.spendingPrivkey).toHaveLength(32);
      expect(keys.metaAddress.viewingPubkey).toHaveLength(32);
      expect(keys.metaAddress.spendingPubkey).toHaveLength(32);
    });
    
    it('should generate unique keys each time', () => {
      const keys1 = generateStealthKeys();
      const keys2 = generateStealthKeys();
      
      expect(keys1.viewingPrivkey).not.toEqual(keys2.viewingPrivkey);
      expect(keys1.spendingPrivkey).not.toEqual(keys2.spendingPrivkey);
    });
  });
  
  describe('computeStealthAddress', () => {
    it('should compute a valid stealth address', () => {
      const keys = generateStealthKeys();
      const result = computeStealthAddress(keys.metaAddress);
      
      expect(result.stealthPubkey).toBeInstanceOf(PublicKey);
      expect(result.ephemeralPubkey).toHaveLength(32);
      expect(result.viewTag).toBeGreaterThanOrEqual(0);
      expect(result.viewTag).toBeLessThanOrEqual(255);
    });
    
    it('should generate unique addresses each time', () => {
      const keys = generateStealthKeys();
      
      const result1 = computeStealthAddress(keys.metaAddress);
      const result2 = computeStealthAddress(keys.metaAddress);
      
      expect(result1.stealthPubkey.toBase58()).not.toEqual(result2.stealthPubkey.toBase58());
      expect(result1.ephemeralPubkey).not.toEqual(result2.ephemeralPubkey);
    });
    
    it('stealth address should be different from spending pubkey', () => {
      const keys = generateStealthKeys();
      const result = computeStealthAddress(keys.metaAddress);
      
      const spendingPubkey = new PublicKey(keys.metaAddress.spendingPubkey);
      expect(result.stealthPubkey.toBase58()).not.toEqual(spendingPubkey.toBase58());
    });
  });
  
  describe('deriveStealthKeypair', () => {
    it('should derive keypair that matches stealth address', () => {
      const keys = generateStealthKeys();
      const result = computeStealthAddressInternal(keys.metaAddress);
      
      const derived = deriveStealthKeypair(
        keys.viewingPrivkey,
        keys.spendingPrivkey,
        result.ephemeralPubkey
      );
      
      // The derived keypair's public key should match the stealth address
      expect(derived.publicKey.toBase58()).toEqual(result.stealthPubkey.toBase58());
    });
    
    it('should derive same keypair for same ephemeral key', () => {
      const keys = generateStealthKeys();
      const result = computeStealthAddressInternal(keys.metaAddress);
      
      const derived1 = deriveStealthKeypair(
        keys.viewingPrivkey,
        keys.spendingPrivkey,
        result.ephemeralPubkey
      );
      
      const derived2 = deriveStealthKeypair(
        keys.viewingPrivkey,
        keys.spendingPrivkey,
        result.ephemeralPubkey
      );
      
      expect(derived1.publicKey.toBase58()).toEqual(derived2.publicKey.toBase58());
    });
    
    it('should derive different keypairs for different ephemeral keys', () => {
      const keys = generateStealthKeys();
      
      const result1 = computeStealthAddressInternal(keys.metaAddress);
      const result2 = computeStealthAddressInternal(keys.metaAddress);
      
      const derived1 = deriveStealthKeypair(
        keys.viewingPrivkey,
        keys.spendingPrivkey,
        result1.ephemeralPubkey
      );
      
      const derived2 = deriveStealthKeypair(
        keys.viewingPrivkey,
        keys.spendingPrivkey,
        result2.ephemeralPubkey
      );
      
      expect(derived1.publicKey.toBase58()).not.toEqual(derived2.publicKey.toBase58());
    });
  });
  
  describe('checkViewTag', () => {
    it('should return true for matching view tag', () => {
      const keys = generateStealthKeys();
      const result = computeStealthAddressInternal(keys.metaAddress);
      
      const matches = checkViewTag(
        keys.viewingPrivkey,
        result.ephemeralPubkey,
        result.viewTag
      );
      
      expect(matches).toBe(true);
    });
    
    it('should return false for non-matching view tag', () => {
      const keys = generateStealthKeys();
      const result = computeStealthAddressInternal(keys.metaAddress);
      
      // Use a different view tag
      const wrongViewTag = (result.viewTag + 1) % 256;
      
      const matches = checkViewTag(
        keys.viewingPrivkey,
        result.ephemeralPubkey,
        wrongViewTag
      );
      
      expect(matches).toBe(false);
    });
    
    it('should filter ~99.6% of non-matching announcements', () => {
      const keys = generateStealthKeys();
      const otherKeys = generateStealthKeys();
      
      // Generate many announcements for other recipients
      let falsePositives = 0;
      const trials = 1000;
      
      for (let i = 0; i < trials; i++) {
        const result = computeStealthAddressInternal(otherKeys.metaAddress);
        if (checkViewTag(keys.viewingPrivkey, result.ephemeralPubkey, result.viewTag)) {
          falsePositives++;
        }
      }
      
      // Expected: ~1/256 = 0.4% false positive rate
      const falsePositiveRate = falsePositives / trials;
      expect(falsePositiveRate).toBeLessThan(0.02); // Allow some variance
    });
  });
  
  describe('computeExpectedStealthAddress', () => {
    it('should compute same address as sender', () => {
      const keys = generateStealthKeys();
      const result = computeStealthAddressInternal(keys.metaAddress);
      
      const expected = computeExpectedStealthAddress(
        keys.viewingPrivkey,
        keys.metaAddress.spendingPubkey,
        result.ephemeralPubkey
      );
      
      expect(expected.toBase58()).toEqual(result.stealthPubkey.toBase58());
    });
  });
});

describe('Meta-Address Encoding', () => {
  describe('encodeMetaAddress', () => {
    it('should encode with st:sol: prefix', () => {
      const keys = generateStealthKeys();
      const encoded = encodeMetaAddress(keys.metaAddress);
      
      expect(encoded.startsWith('st:sol:')).toBe(true);
    });
    
    it('should be deterministic', () => {
      const keys = generateStealthKeys();
      
      const encoded1 = encodeMetaAddress(keys.metaAddress);
      const encoded2 = encodeMetaAddress(keys.metaAddress);
      
      expect(encoded1).toEqual(encoded2);
    });
  });
  
  describe('decodeMetaAddress', () => {
    it('should decode what was encoded', () => {
      const keys = generateStealthKeys();
      const encoded = encodeMetaAddress(keys.metaAddress);
      const decoded = decodeMetaAddress(encoded);
      
      expect(decoded.viewingPubkey).toEqual(keys.metaAddress.viewingPubkey);
      expect(decoded.spendingPubkey).toEqual(keys.metaAddress.spendingPubkey);
    });
    
    it('should throw on invalid prefix', () => {
      expect(() => decodeMetaAddress('invalid:address')).toThrow();
    });
    
    it('should throw on invalid base58', () => {
      expect(() => decodeMetaAddress('st:sol:invalid!!!')).toThrow();
    });
  });
  
  describe('isValidMetaAddress', () => {
    it('should return true for valid addresses', () => {
      const keys = generateStealthKeys();
      const encoded = encodeMetaAddress(keys.metaAddress);
      
      expect(isValidMetaAddress(encoded)).toBe(true);
    });
    
    it('should return false for invalid addresses', () => {
      expect(isValidMetaAddress('invalid')).toBe(false);
      expect(isValidMetaAddress('st:sol:')).toBe(false);
      expect(isValidMetaAddress('st:eth:ABC123')).toBe(false);
    });
  });
});

describe('StealthAccount', () => {
  it('should generate new account', () => {
    const account = new StealthAccount();
    
    expect(account.getMetaAddressString()).toMatch(/^st:sol:/);
  });
  
  it('should serialize and deserialize', () => {
    const account = new StealthAccount();
    const serialized = account.serialize();
    const restored = new StealthAccount(serialized);
    
    expect(restored.getMetaAddressString()).toEqual(account.getMetaAddressString());
  });
  
  it('should derive correct keypair', () => {
    const account = new StealthAccount();
    const result = computeStealthAddressInternal(account.getMetaAddress());
    
    const derived = account.deriveKeypair(result.ephemeralPubkey);
    
    expect(derived.publicKey.toBase58()).toEqual(result.stealthPubkey.toBase58());
  });
});

describe('StealthPayment', () => {
  it('should create payment from meta-address string', () => {
    const account = new StealthAccount();
    const payment = StealthPayment.create(account.getMetaAddressString());
    
    expect(payment.stealthAddress).toBeInstanceOf(PublicKey);
    expect(payment.ephemeralPubkey).toHaveLength(32);
  });
  
  it('should create payment from meta-address object', () => {
    const account = new StealthAccount();
    const payment = StealthPayment.create(account.getMetaAddress());
    
    expect(payment.stealthAddress).toBeInstanceOf(PublicKey);
  });
});

describe('Announcement Serialization', () => {
  it('should serialize and deserialize', () => {
    const account = new StealthAccount();
    const payment = StealthPayment.create(account.getMetaAddress());
    const announcement = payment.getAnnouncement();
    
    const serialized = serializeAnnouncement(announcement);
    const deserialized = deserializeAnnouncement(serialized);
    
    expect(deserialized).not.toBeNull();
    expect(deserialized!.viewTag).toEqual(announcement.viewTag);
    expect(deserialized!.stealthAddress.toBase58()).toEqual(announcement.stealthAddress.toBase58());
    expect(Buffer.from(deserialized!.ephemeralPubkey).toString('hex'))
      .toEqual(Buffer.from(announcement.ephemeralPubkey).toString('hex'));
  });
  
  it('should return null for invalid data', () => {
    expect(deserializeAnnouncement('invalid')).toBeNull();
    expect(deserializeAnnouncement('{}')).toBeNull();
    expect(deserializeAnnouncement('{"t": "OTHER"}')).toBeNull();
  });
});

describe('End-to-End Flow', () => {
  it('should complete full send-receive cycle (crypto only)', () => {
    // 1. Alice generates stealth identity
    const alice = new StealthAccount();
    const aliceMetaAddress = alice.getMetaAddressString();
    
    // 2. Bob creates payment
    const payment = StealthPayment.create(aliceMetaAddress);
    
    // 3. Bob would send SOL and announce (simulated)
    const announcement = payment.getAnnouncement();
    
    // 4. Alice scans and finds payment
    expect(alice.checkViewTag(announcement.ephemeralPubkey, announcement.viewTag)).toBe(true);
    
    // 5. Alice verifies the stealth address
    const expectedAddress = alice.computeExpectedAddress(announcement.ephemeralPubkey);
    expect(expectedAddress.toBase58()).toEqual(announcement.stealthAddress.toBase58());
    
    // 6. Alice derives keypair for this address
    const keypair = alice.deriveKeypair(announcement.ephemeralPubkey);
    expect(keypair.publicKey.toBase58()).toEqual(announcement.stealthAddress.toBase58());
    
    // 7. Alice can now sign transactions with this keypair
    // (Actual signing tested separately)
  });
  
  it('should generate unique addresses for multiple payments', () => {
    const alice = new StealthAccount();
    
    const payment1 = StealthPayment.create(alice.getMetaAddress());
    const payment2 = StealthPayment.create(alice.getMetaAddress());
    const payment3 = StealthPayment.create(alice.getMetaAddress());
    
    const addresses = new Set([
      payment1.stealthAddress.toBase58(),
      payment2.stealthAddress.toBase58(),
      payment3.stealthAddress.toBase58(),
    ]);
    
    expect(addresses.size).toBe(3); // All unique
    
    // Alice can derive keypairs for all
    const keypair1 = alice.deriveKeypair(payment1.ephemeralPubkey);
    const keypair2 = alice.deriveKeypair(payment2.ephemeralPubkey);
    const keypair3 = alice.deriveKeypair(payment3.ephemeralPubkey);
    
    expect(keypair1.publicKey.toBase58()).toEqual(payment1.stealthAddress.toBase58());
    expect(keypair2.publicKey.toBase58()).toEqual(payment2.stealthAddress.toBase58());
    expect(keypair3.publicKey.toBase58()).toEqual(payment3.stealthAddress.toBase58());
  });
});
