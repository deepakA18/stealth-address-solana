/**
 * Stealth Meta-Address Encoding
 * 
 * Provides encoding/decoding for stealth meta-addresses.
 * Format: st:sol:<viewing_pubkey_base58><spending_pubkey_base58>
 * 
 * This is what Alice publishes and shares with others.
 */

import bs58 from 'bs58';
import { StealthMetaAddress } from './crypto';

const PREFIX = 'st:sol:';
const PUBKEY_LENGTH = 32;

/**
 * Encode a stealth meta-address to a shareable string.
 * 
 * Format: st:sol:<base58(viewing_pubkey || spending_pubkey)>
 * 
 * @param meta - The stealth meta-address to encode
 * @returns Encoded string like "st:sol:ABC123..."
 */
export function encodeMetaAddress(meta: StealthMetaAddress): string {
  // Validate input
  if (meta.viewingPubkey.length !== PUBKEY_LENGTH) {
    throw new Error(`Invalid viewing pubkey length: ${meta.viewingPubkey.length}`);
  }
  if (meta.spendingPubkey.length !== PUBKEY_LENGTH) {
    throw new Error(`Invalid spending pubkey length: ${meta.spendingPubkey.length}`);
  }
  
  // Concatenate both pubkeys and encode as base58
  const combined = new Uint8Array(PUBKEY_LENGTH * 2);
  combined.set(meta.viewingPubkey, 0);
  combined.set(meta.spendingPubkey, PUBKEY_LENGTH);
  
  return PREFIX + bs58.encode(combined);
}

/**
 * Decode a stealth meta-address from a string.
 * 
 * @param encoded - Encoded string like "st:sol:ABC123..."
 * @returns The decoded stealth meta-address
 */
export function decodeMetaAddress(encoded: string): StealthMetaAddress {
  // Check prefix
  if (!encoded.startsWith(PREFIX)) {
    throw new Error(`Invalid stealth address format: must start with "${PREFIX}"`);
  }
  
  // Decode base58 payload
  const payload = encoded.slice(PREFIX.length);
  let combined: Uint8Array;
  
  try {
    combined = bs58.decode(payload);
  } catch (e) {
    throw new Error('Invalid base58 encoding in stealth address');
  }
  
  // Validate length
  if (combined.length !== PUBKEY_LENGTH * 2) {
    throw new Error(`Invalid stealth address length: expected ${PUBKEY_LENGTH * 2} bytes, got ${combined.length}`);
  }
  
  return {
    viewingPubkey: combined.slice(0, PUBKEY_LENGTH),
    spendingPubkey: combined.slice(PUBKEY_LENGTH),
  };
}

/**
 * Validate a stealth meta-address string.
 * 
 * @param encoded - The string to validate
 * @returns true if valid, false otherwise
 */
export function isValidMetaAddress(encoded: string): boolean {
  try {
    decodeMetaAddress(encoded);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a shareable payment link for a stealth meta-address.
 * 
 * @param meta - The stealth meta-address
 * @param baseUrl - Optional base URL (defaults to a generic format)
 * @returns Payment link URL
 */
export function createPaymentLink(
  meta: StealthMetaAddress,
  baseUrl: string = 'https://pay.stealth.sol'
): string {
  const encoded = encodeMetaAddress(meta);
  return `${baseUrl}/${encoded}`;
}

/**
 * Parse a payment link to extract the meta-address.
 * 
 * @param url - The payment link URL
 * @returns The decoded stealth meta-address
 */
export function parsePaymentLink(url: string): StealthMetaAddress {
  // Handle various URL formats
  const urlObj = new URL(url);
  let encoded = urlObj.pathname.slice(1); // Remove leading /
  
  // Also check hash and query params
  if (!encoded.startsWith(PREFIX)) {
    if (urlObj.hash.startsWith('#' + PREFIX)) {
      encoded = urlObj.hash.slice(1);
    } else if (urlObj.searchParams.has('address')) {
      encoded = urlObj.searchParams.get('address')!;
    }
  }
  
  return decodeMetaAddress(encoded);
}
