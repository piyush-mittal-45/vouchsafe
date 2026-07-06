import { computeLeaf, computeParent, sha256 } from '../lib/soroban';
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

// These tests exercise the Merkle commitment math the issuance flow builds and
// the AccessControl contract re-verifies: hiding commitments (salted leaves),
// sorted-pair parent hashing, and sibling-proof root reconstruction. If this
// drifts from the contract logic, selective disclosure proofs stop verifying.

const salt = (byte: number) => Buffer.alloc(32, byte);

describe('Merkle commitment properties', () => {
  test('computeLeaf changes when the salt changes (hiding commitment)', () => {
    const a = computeLeaf('full_name', 'Alice Smith', salt(1));
    const b = computeLeaf('full_name', 'Alice Smith', salt(2));
    expect(a.equals(b)).toBe(false);
  });

  test('computeLeaf changes when the field name changes, even with equal values', () => {
    const a = computeLeaf('full_name', 'X', salt(1));
    const b = computeLeaf('date_of_birth', 'X', salt(1));
    expect(a.equals(b)).toBe(false);
  });

  test('computeParent differs for different children', () => {
    const a = sha256(Buffer.from('a'));
    const b = sha256(Buffer.from('b'));
    const c = sha256(Buffer.from('c'));
    expect(computeParent(a, b).equals(computeParent(a, c))).toBe(false);
  });
});

describe('Merkle proof round-trip (issuance tree shape)', () => {
  // Same tree the issuance flow builds:
  //   parent0 = parent(leaf0, leaf1); parent1 = parent(leaf2, leaf2)
  //   root    = parent(parent0, parent1)
  const buildTree = () => {
    const leaf0 = computeLeaf('full_name', 'Alice Smith', salt(1));
    const leaf1 = computeLeaf('date_of_birth', '1990-01-01', salt(2));
    const leaf2 = computeLeaf('license_class', 'Class A', salt(3));
    const parent0 = computeParent(leaf0, leaf1);
    const parent1 = computeParent(leaf2, leaf2);
    return { leaf0, leaf1, leaf2, parent0, parent1, root: computeParent(parent0, parent1) };
  };

  test('reconstructs the root from a leaf and its sibling proof', () => {
    const { leaf1, parent1, root } = buildTree();

    // Disclosing full_name: proof = [leaf1, parent1], walked like the contract
    let current = computeLeaf('full_name', 'Alice Smith', salt(1));
    for (const sibling of [leaf1, parent1]) {
      current = computeParent(current, sibling);
    }
    expect(current.equals(root)).toBe(true);
  });

  test('fails to reconstruct the root when the salt is wrong (tamper check)', () => {
    const { leaf1, parent1, root } = buildTree();

    let current = computeLeaf('full_name', 'Alice Smith', salt(9)); // wrong salt
    for (const sibling of [leaf1, parent1]) {
      current = computeParent(current, sibling);
    }
    expect(current.equals(root)).toBe(false);
  });

  test('fails to reconstruct the root when the value is tampered', () => {
    const { leaf1, parent1, root } = buildTree();

    let current = computeLeaf('full_name', 'Mallory Smith', salt(1)); // wrong value
    for (const sibling of [leaf1, parent1]) {
      current = computeParent(current, sibling);
    }
    expect(current.equals(root)).toBe(false);
  });
});
