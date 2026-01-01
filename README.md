# Solana Stealth Addresses

Fluidkey-style stealth addresses for Solana. Privacy-preserving payments without smart contracts.

## What are Stealth Addresses?

Stealth addresses allow someone to receive payments at a unique, one-time address that only they can spend from - without revealing their identity or linking payments together.

**How it works:**
1. Alice publishes a "stealth meta-address" (like `st:sol:ABC123...`)
2. Bob uses this to derive a unique stealth address for Alice
3. Bob sends SOL to that address and announces an ephemeral pubkey
4. Alice scans announcements, finds payments meant for her
5. Alice derives the private key and spends the funds

**Privacy guarantees:**
- Each payment goes to a unique address
- Payments cannot be linked to Alice's identity
- Only Alice can derive the spending key
- No on-chain smart contracts required

## Installation

```bash
npm install @solana-stealth/sdk
# or
yarn add @solana-stealth/sdk
```

## Quick Start

```typescript
import { StealthAccount, StealthPayment, StealthScanner } from '@solana-stealth/sdk';
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';

// Alice: Generate stealth identity (one-time setup)
const alice = new StealthAccount();
console.log("Share this:", alice.getMetaAddressString());
// Output: st:sol:7Bx3p...

// Bob: Send to Alice
const connection = new Connection('https://api.devnet.solana.com');
const bobKeypair = Keypair.generate(); // Bob's wallet

const payment = StealthPayment.create(alice.getMetaAddressString());
await payment.send(connection, bobKeypair, 0.1 * LAMPORTS_PER_SOL);

// Alice: Find and withdraw payment
const scanner = new StealthScanner(alice, connection);
const announcements = [payment.getAnnouncement()]; // In production, fetch from chain
const received = await scanner.scanAnnouncements(announcements);

for (const p of received) {
  console.log(`Found ${p.balance / LAMPORTS_PER_SOL} SOL`);
  await scanner.withdraw(p, aliceMainWallet.publicKey);
}
```

## API Reference

### StealthAccount

Represents a user's stealth identity.

```typescript
// Generate new account
const account = new StealthAccount();

// Get meta-address for sharing
const metaAddress = account.getMetaAddressString(); // "st:sol:..."

// Serialize for storage (includes private keys!)
const json = account.serialize();

// Restore from storage
const restored = new StealthAccount(json);

// Derive keypair for a specific payment
const keypair = account.deriveKeypair(ephemeralPubkey);
```

### StealthPayment

Create and send stealth payments.

```typescript
// Create payment from meta-address
const payment = StealthPayment.create("st:sol:...");

// Get stealth address to send to
console.log(payment.stealthAddress.toBase58());

// Send SOL with announcement
await payment.send(connection, senderKeypair, lamports);

// Or get announcement for custom handling
const announcement = payment.getAnnouncement();
```

### StealthScanner

Scan for incoming payments.

```typescript
const scanner = new StealthScanner(account, connection);

// Scan a list of announcements
const received = await scanner.scanAnnouncements(announcements);

// Withdraw to destination
for (const payment of received) {
  await scanner.withdraw(payment, destinationPubkey);
}
```

### Low-Level Functions

```typescript
import {
  generateStealthKeys,
  computeStealthAddress,
  deriveStealthKeypair,
  checkViewTag,
  encodeMetaAddress,
  decodeMetaAddress,
} from '@solana-stealth/sdk';

// Generate keys directly
const keys = generateStealthKeys();

// Compute stealth address
const result = computeStealthAddress(keys.metaAddress);

// Check if announcement might be for us (fast filter)
const mightBeOurs = checkViewTag(viewingPrivkey, ephemeralPubkey, viewTag);

// Derive spending keypair
const keypair = deriveStealthKeypair(viewingPrivkey, spendingPrivkey, ephemeralPubkey);
```

## How It Works

### Cryptographic Foundation

This SDK uses Ed25519 key derivation, similar to EIP-5564 but adapted for Solana:

1. **Meta-Address**: Two Ed25519 public keys (viewing + spending)
2. **Shared Secret**: X25519 ECDH between ephemeral key and viewing key
3. **Key Derivation**: `P_stealth = P_spend + hash(shared_secret) * G`
4. **Private Key**: `p_stealth = p_spend + hash(shared_secret)`

The derived keypair is a valid Ed25519 keypair that can sign Solana transactions directly.

### View Tags

View tags (from EIP-5564) enable efficient scanning:
- First byte of the shared secret hash
- Filters ~99.6% of non-matching announcements
- Recipients only need full ECDH for matching view tags

### Announcement Format

```json
{
  "v": 1,
  "t": "STEALTH",
  "e": "<ephemeral_pubkey_base58>",
  "vt": 42,
  "s": "<stealth_address_base58>"
}
```

Announcements can be stored:
- On-chain via Memo program
- Off-chain in a registry/indexer
- In a decentralized storage system

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  SENDER                              RECIPIENT              │
│                                                             │
│  1. Get meta-address ──────────────► Published publicly     │
│                                                             │
│  2. Compute stealth address                                 │
│     (ephemeral key + ECDH)                                 │
│                                                             │
│  3. Send SOL ──────────────────────► Stealth Address        │
│                                                             │
│  4. Announce ephemeral pubkey ─────► Memo / Registry        │
│                                                             │
│                                      5. Scan announcements  │
│                                         (view tag filter)   │
│                                                             │
│                                      6. Derive keypair      │
│                                                             │
│                                      7. Spend funds ───────►│
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Security Considerations

1. **Private Key Storage**: The spending private key must be kept secure. Anyone with it can spend from all stealth addresses.

2. **Viewing Key Sharing**: The viewing key can be shared with a scanner service for convenience, but this reveals which payments are yours (not the spending capability).

3. **Announcement Privacy**: Announcements don't reveal recipient identity, but the sender is visible on-chain. Use a relayer for sender privacy.

4. **Withdrawal Linking**: Withdrawing to the same address links stealth payments. Use fresh addresses or spend directly from stealth accounts.

## Limitations

- **SOL Only** (for now): SPL tokens require ATA creation
- **Rent**: Stealth accounts need minimum balance for rent exemption
- **Scanning**: Requires scanning all announcements (use indexer for scale)

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build

# Run example
npx ts-node examples/basic-transfer.ts
```

## License

MIT

## Credits

Inspired by [Fluidkey](https://fluidkey.com) and [EIP-5564](https://eips.ethereum.org/EIPS/eip-5564).
