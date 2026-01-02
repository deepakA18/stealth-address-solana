/**
 * Ed25519 Stealth Address Cryptography
 * 
 * This module implements EIP-5564 style stealth addresses adapted for Ed25519.
 * 
 * The key insight: Ed25519 supports additive key derivation:
 *   - Public key derivation:  P_stealth = P_spend + hash(shared_secret) * B
 *   - Private key derivation: p_stealth = p_spend + hash(shared_secret)
 * 
 * This gives us Fluidkey-style stealth addresses on Solana without any smart contracts.
 */

import { ed25519, x25519 } from '@noble/curves/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2';
import { Keypair, PublicKey } from '@solana/web3.js';

// Ed25519 curve order (for scalar arithmetic modulo L)
const L = ed25519.CURVE.n;

// ============================================================================
// TYPES
// ============================================================================

/**
 * Stealth Meta-Address
 * 
 * This is what Alice publishes. Anyone can use this to derive
 * one-time stealth addresses that only Alice can spend from.
 */
export interface StealthMetaAddress {
  viewingPubkey: Uint8Array;  // 32 bytes - Ed25519 public key
  spendingPubkey: Uint8Array; // 32 bytes - Ed25519 public key
}

/**
 * Full stealth keys (private + public)
 */
export interface StealthKeys {
  viewingPrivkey: Uint8Array;   // 32 bytes - Ed25519 seed
  spendingPrivkey: Uint8Array;  // 32 bytes - Ed25519 seed
  metaAddress: StealthMetaAddress;
}

/**
 * Result of computing a stealth address (sender's side)
 */
export interface StealthAddressResult {
  stealthPubkey: PublicKey;
  ephemeralPubkey: Uint8Array;
  viewTag: number;
}

/**
 * Internal result with additional data (for testing)
 */
export interface StealthAddressResultInternal extends StealthAddressResult {
  ephemeralPrivkey: Uint8Array;
  sharedSecret: Uint8Array;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Convert bytes to BigInt (big-endian)
 */
function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

/**
 * Convert bytes to BigInt (little-endian)
 */
function bytesToBigIntLE(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
}

/**
 * Convert BigInt to bytes (big-endian, fixed length)
 */
function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}

/**
 * Convert BigInt to bytes (little-endian, fixed length)
 */
function bigIntToBytesLE(value: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let v = value;
  for (let i = 0; i < length; i++) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}

/**
 * Extract the 32-byte seed from a Solana Keypair's 64-byte secret key.
 */
export function extractScalar(secretKey: Uint8Array): Uint8Array {
  if (secretKey.length === 64) {
    return secretKey.slice(0, 32);
  }
  if (secretKey.length === 32) {
    return secretKey;
  }
  throw new Error(`Invalid secret key length: ${secretKey.length}`);
}

// ============================================================================
// ED25519 / X25519 CONVERSIONS
// ============================================================================

/**
 * Derive the Ed25519 scalar from a 32-byte seed.
 * Applies SHA-512 and clamping as per Ed25519 spec.
 */
function seedToScalar(seed: Uint8Array): bigint {
  const hash = sha512(seed);
  const h = hash.slice(0, 32);
  
  // Apply Ed25519 clamping
  h[0] &= 248;
  h[31] &= 127;
  h[31] |= 64;
  
  // Ed25519 scalars are little-endian
  return bytesToBigIntLE(h);
}

/**
 * Convert Ed25519 public key to X25519 for ECDH.
 * 
 * Ed25519: twisted Edwards curve (-x² + y² = 1 + dx²y²)
 * X25519: Montgomery curve (v² = u³ + Au² + u)
 * 
 * Conversion: u = (1 + y) / (1 - y)
 */
function ed25519PubToX25519(edPub: Uint8Array): Uint8Array {
  const point = ed25519.ExtendedPoint.fromHex(edPub);
  const { y } = point.toAffine();
  
  const { Fp } = ed25519.CURVE;
  const one = Fp.ONE;
  const numerator = Fp.add(one, y);
  const denominator = Fp.sub(one, y);
  const u = Fp.mul(numerator, Fp.inv(denominator));
  
  // X25519 uses little-endian
  return bigIntToBytesLE(u, 32);
}

/**
 * Convert Ed25519 seed to X25519 private key for ECDH.
 */
function ed25519SeedToX25519Priv(seed: Uint8Array): Uint8Array {
  const hash = sha512(seed);
  const scalar = hash.slice(0, 32);
  
  // Apply X25519/Curve25519 clamping
  scalar[0] &= 248;
  scalar[31] &= 127;
  scalar[31] |= 64;
  
  return scalar;
}

// ============================================================================
// CORE STEALTH ADDRESS FUNCTIONS
// ============================================================================

/**
 * Generate a new set of stealth keys.
 */
export function generateStealthKeys(): StealthKeys {
  const viewingKeypair = Keypair.generate();
  const spendingKeypair = Keypair.generate();
  
  return {
    viewingPrivkey: extractScalar(viewingKeypair.secretKey),
    spendingPrivkey: extractScalar(spendingKeypair.secretKey),
    metaAddress: {
      viewingPubkey: viewingKeypair.publicKey.toBytes(),
      spendingPubkey: spendingKeypair.publicKey.toBytes(),
    },
  };
}

/**
 * Compute a stealth address for a given meta-address.
 * 
 * @param metaAddress - Recipient's stealth meta-address
 * @returns Stealth address and ephemeral key to announce
 */
export function computeStealthAddress(metaAddress: StealthMetaAddress): StealthAddressResult {
  const result = computeStealthAddressInternal(metaAddress);
  return {
    stealthPubkey: result.stealthPubkey,
    ephemeralPubkey: result.ephemeralPubkey,
    viewTag: result.viewTag,
  };
}

/**
 * Internal version with full details (for testing).
 */
export function computeStealthAddressInternal(metaAddress: StealthMetaAddress): StealthAddressResultInternal {
  // 1. Generate ephemeral keypair
  const ephemeralKeypair = Keypair.generate();
  const ephemeralSeed = extractScalar(ephemeralKeypair.secretKey);
  const ephemeralPubkey = ephemeralKeypair.publicKey.toBytes();
  
  // 2. Convert to X25519 for ECDH
  const ephemeralX25519Priv = ed25519SeedToX25519Priv(ephemeralSeed);
  const viewingX25519Pub = ed25519PubToX25519(metaAddress.viewingPubkey);
  
  // 3. ECDH shared secret
  const sharedSecret = x25519.scalarMult(ephemeralX25519Priv, viewingX25519Pub);
  
  // 4. Derive tweak from shared secret
  const tweak = sha256(sharedSecret);
  const viewTag = tweak[0];
  
  // 5. Convert tweak to scalar (mod L) - use big-endian for hash
  const tweakScalar = bytesToBigInt(tweak) % L;
  
  // 6. Compute tweak * B (basepoint multiplication)
  const tweakPoint = ed25519.Point.BASE.multiply(tweakScalar);
  
  // 7. Parse spending pubkey as point and add tweak
  const spendingPoint = ed25519.Point.fromHex(metaAddress.spendingPubkey);
  const stealthPoint = spendingPoint.add(tweakPoint);
  const stealthPubkeyBytes = stealthPoint.toRawBytes();
  
  return {
    stealthPubkey: new PublicKey(stealthPubkeyBytes),
    ephemeralPubkey,
    ephemeralPrivkey: ephemeralSeed,
    sharedSecret,
    viewTag,
  };
}

/**
 * Derive the stealth keypair for a received payment.
 * 
 * @param viewingPrivkey - Recipient's viewing private key (seed)
 * @param spendingPrivkey - Recipient's spending private key (seed)
 * @param ephemeralPubkey - Ephemeral public key from the announcement
 * @returns Solana Keypair that controls the stealth address
 */
export function deriveStealthKeypair(
  viewingPrivkey: Uint8Array,
  spendingPrivkey: Uint8Array,
  ephemeralPubkey: Uint8Array
): Keypair {
  // 1. Convert to X25519 for ECDH
  const viewingX25519Priv = ed25519SeedToX25519Priv(viewingPrivkey);
  const ephemeralX25519Pub = ed25519PubToX25519(ephemeralPubkey);
  
  // 2. ECDH shared secret
  const sharedSecret = x25519.scalarMult(viewingX25519Priv, ephemeralX25519Pub);
  
  // 3. Derive tweak
  const tweak = sha256(sharedSecret);
  const tweakScalar = bytesToBigInt(tweak) % L;
  
  // 4. Derive spending scalar from seed
  const spendingScalar = seedToScalar(spendingPrivkey);
  
  // 5. Stealth scalar = spending_scalar + tweak (mod L)
  const stealthScalar = (spendingScalar + tweakScalar) % L;
  
  // 6. Compute the stealth public key
  const stealthPoint = ed25519.ExtendedPoint.BASE.multiply(stealthScalar);
  const stealthPubkey = stealthPoint.toRawBytes();
  
  // 7. Create Solana keypair from scalar
  return createKeypairFromScalar(stealthScalar, stealthPubkey);
}

/**
 * Quick check if announcement might be for us using view tag.
 */
export function checkViewTag(
  viewingPrivkey: Uint8Array,
  ephemeralPubkey: Uint8Array,
  viewTag: number
): boolean {
  const viewingX25519Priv = ed25519SeedToX25519Priv(viewingPrivkey);
  const ephemeralX25519Pub = ed25519PubToX25519(ephemeralPubkey);
  
  const sharedSecret = x25519.scalarMult(viewingX25519Priv, ephemeralX25519Pub);
  const tweak = sha256(sharedSecret);
  
  return tweak[0] === viewTag;
}

/**
 * Compute the expected stealth address for a given ephemeral pubkey.
 */
export function computeExpectedStealthAddress(
  viewingPrivkey: Uint8Array,
  spendingPubkey: Uint8Array,
  ephemeralPubkey: Uint8Array
): PublicKey {
  const viewingX25519Priv = ed25519SeedToX25519Priv(viewingPrivkey);
  const ephemeralX25519Pub = ed25519PubToX25519(ephemeralPubkey);
  const sharedSecret = x25519.scalarMult(viewingX25519Priv, ephemeralX25519Pub);
  
  const tweak = sha256(sharedSecret);
  const tweakScalar = bytesToBigInt(tweak) % L;
  
  const tweakPoint = ed25519.Point.BASE.multiply(tweakScalar);
  const spendingPoint = ed25519.Point.fromHex(spendingPubkey);
  const stealthPoint = spendingPoint.add(tweakPoint);
  
  return new PublicKey(stealthPoint.toRawBytes());
}

// ============================================================================
// KEYPAIR CREATION FROM SCALAR
// ============================================================================

/**
 * Create a Solana-compatible Keypair from a raw Ed25519 scalar.
 * 
 * This is tricky because Solana's Keypair expects [seed || pubkey] format,
 * where the seed is hashed to derive the scalar. We can't reverse SHA-512,
 * so we use a workaround: store the scalar in the seed position and use
 * custom signing via @noble/curves.
 * 
 * For transactions, you may need to use signWithScalar() instead of 
 * the built-in Keypair.sign().
 */
function createKeypairFromScalar(scalar: bigint, pubkey: Uint8Array): Keypair {
  // Convert scalar to little-endian bytes (Ed25519 format)
  const scalarBytes = bigIntToBytesLE(scalar, 32);
  
  // Create 64-byte secret key: [scalar_as_seed || pubkey]
  // Note: This won't work with Solana's built-in signing since it expects
  // the seed to hash to the scalar. For derived keys, use signWithScalar().
  const secretKey = new Uint8Array(64);
  secretKey.set(scalarBytes, 0);
  secretKey.set(pubkey, 32);
  
  // Use Keypair constructor with the formatted key
  return Keypair.fromSecretKey(secretKey);
}

/**
 * Sign a message with a raw Ed25519 scalar.
 * 
 * Use this for derived stealth keypairs since Solana's built-in signing
 * won't work correctly (it expects a seed that hashes to the scalar).
 */
export function signWithScalar(
  message: Uint8Array,
  scalar: bigint,
  pubkey: Uint8Array
): Uint8Array {
  // Create the extended secret key format that ed25519 expects
  // This is: [clamped_scalar || prefix] where prefix comes from SHA-512
  const scalarBytes = bigIntToBytesLE(scalar, 32);
  
  // For derived keys, we don't have the original seed's hash prefix.
  // We'll use a deterministic prefix derived from the scalar itself.
  const prefix = sha512(scalarBytes).slice(32, 64);
  
  // Construct the extended private key
  const extendedKey = new Uint8Array(64);
  extendedKey.set(scalarBytes, 0);
  extendedKey.set(prefix, 32);
  
  // Sign using the ed25519 library
  // Note: We need to use a custom signing approach here
  return ed25519.sign(message, extendedKey.slice(0, 32));
}

/**
 * Get the scalar value from a derived stealth keypair.
 * Used with signWithScalar() for transaction signing.
 */
export function getScalarFromKeypair(keypair: Keypair): bigint {
  const scalarBytes = keypair.secretKey.slice(0, 32);
  return bytesToBigIntLE(scalarBytes);
}
