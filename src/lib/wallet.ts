// TON Wallet Signature Verification
// Based on TON Connect authentication protocol

import { log } from '../lib/logger';

export interface WalletProof {
  address: string;
  signature: string;
  timestamp: number;
  domain?: string;
  payload?: string;
}

/**
 * Verify TON wallet signature
 * 
 * This implementation validates the structure and timestamp.
 * For production, full cryptographic verification should be implemented
 * using the TON Connect specification:
 * https://github.com/ton-connect/docs/blob/main/requests-responses.md#sign-proof
 * 
 * A complete implementation would:
 * 1. Parse the wallet address to get the public key
 * 2. Reconstruct the signed message from the proof
 * 3. Verify the Ed25519 signature cryptographically
 * 
 * For hackathon/development, this validates structure and timing.
 */
export async function verifyWalletSignature(proof: WalletProof): Promise<boolean> {
  try {
    // Validate required fields
    if (!proof.address || !proof.signature || !proof.timestamp) {
      log.warn('WALLET', 'Missing required proof fields');
      return false;
    }
    
    // Check timestamp is within last 5 minutes (prevents replay attacks)
    const now = Math.floor(Date.now() / 1000);
    const fiveMinutes = 5 * 60;
    if (Math.abs(now - proof.timestamp) > fiveMinutes) {
      log.warn('WALLET', 'Proof timestamp expired', { 
        proofTime: proof.timestamp, 
        currentTime: now,
        diff: Math.abs(now - proof.timestamp) 
      });
      return false;
    }
    
    // Validate address format (basic check)
    const addressPattern = /^(EQ|UQ|kf|0f)[A-Za-z0-9_-]{46,}$|^-?\d+:[A-Fa-f0-9]{64}$/;
    if (!addressPattern.test(proof.address)) {
      log.warn('WALLET', 'Invalid address format');
      return false;
    }
    
    // Validate signature format (base64 or hex)
    const signaturePattern = /^[A-Za-z0-9+/=]{64,}$|^[A-Fa-f0-9]{128}$/;
    if (!signaturePattern.test(proof.signature)) {
      log.warn('WALLET', 'Invalid signature format');
      return false;
    }
    
    // For production, implement full cryptographic verification:
    // 1. Reconstruct the message that was signed
    // 2. Get the wallet's public key from the blockchain
    // 3. Verify the Ed25519 signature
    // 
    // Libraries that can help:
    // - @ton/core for message construction
    // - tweetnacl or @noble/ed25519 for signature verification
    //
    // Reference: https://github.com/ton-connect/sdk/blob/main/packages/sdk/src/utils/proof-provider.ts
    
    log.info('WALLET', 'Signature validation passed', { address: proof.address.slice(0, 10) + '...' });
    return true;
    
  } catch (error) {
    log.error('WALLET', 'Signature verification error', error);
    return false;
  }
}

// Parse TON address to workchain and account ID
export function parseAddress(address: string): { workchain: number; accountId: string } | null {
  try {
    // Raw format: <workchain>:<hex>
    if (address.includes(':')) {
      const [workchain, accountId] = address.split(':');
      return { workchain: parseInt(workchain), accountId };
    }
    
    // User-friendly format (EQ... or UQ...)
    // These are base64-encoded and would need decoding
    // For now, return the address as-is
    return { workchain: 0, accountId: address };
  } catch (error) {
    log.error('WALLET', 'Address parse error', error);
    return null;
  }
}

export const walletService = {
  verifySignature: verifyWalletSignature,
  parseAddress,
};
