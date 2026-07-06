import { sha256, computeLeaf, computeParent } from '../lib/soroban';
import { Buffer } from 'buffer';

// Mock the Stellar SDK to prevent loading deep ES Module dependencies during tests
jest.mock('@stellar/stellar-sdk', () => {
  return {
    xdr: {
      ScVal: {
        scvSymbol: (name: string) => ({
          toXDR: () => Buffer.from(name, 'utf8')
        })
      }
    }
  };
});

describe('Soroban Frontend Cryptographic Utilities', () => {
  test('sha256 hashes correctly', () => {
    const input = Buffer.from('hello', 'utf8');
    const hash = sha256(input);
    expect(hash.toString('hex')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  test('computeParent sorts and hashes correctly', () => {
    const hashA = Buffer.from('a'.repeat(32), 'hex');
    const hashB = Buffer.from('b'.repeat(32), 'hex');
    const parent1 = computeParent(hashA, hashB);
    const parent2 = computeParent(hashB, hashA);
    // Since computeParent sorts inputs, order should not change the output parent hash
    expect(parent1.toString('hex')).toBe(parent2.toString('hex'));
  });

  test('computeLeaf computes correctly', () => {
    const salt = Buffer.from('0'.repeat(64), 'hex');
    const leaf = computeLeaf('fullName', 'John Doe', salt);
    expect(leaf).toBeInstanceOf(Buffer);
    expect(leaf.length).toBe(32);
  });
});
