import {
  Contract,
  TransactionBuilder,
  Account,
  Networks,
  Address,
  xdr,
  nativeToScVal,
  scValToNative,
  Keypair,
  rpc
} from '@stellar/stellar-sdk';
import cryptoBrowser from 'crypto';
import { Buffer } from 'buffer';

// Contract addresses from env vars
export const REGISTRY_ID = process.env.NEXT_PUBLIC_REGISTRY_ID || '';
export const VAULT_ID = process.env.NEXT_PUBLIC_VAULT_ID || '';
export const ACCESS_ID = process.env.NEXT_PUBLIC_ACCESS_ID || '';

const HORIZON_URL = 'https://horizon-testnet.stellar.org';

// Fetch account detail (sequence number) from Horizon
export async function getSourceAccount(address: string): Promise<Account> {
  const res = await fetch(`${HORIZON_URL}/accounts/${address}`);
  if (!res.ok) {
    throw new Error(`Failed to load account from Horizon: ${res.statusText}`);
  }
  const data = await res.json();
  return new Account(address, data.sequence);
}

// Fetch XLM Balance
export async function getXlmBalance(address: string): Promise<string> {
  try {
    const res = await fetch(`${HORIZON_URL}/accounts/${address}`);
    if (!res.ok) return '0.0';
    const data = await res.json();
    const balance = data.balances.find(
      (b: { asset_type: string; balance: string }) => b.asset_type === 'native'
    );
    return balance ? parseFloat(balance.balance).toFixed(2) : '0.0';
  } catch (err) {
    console.error(err);
    return '0.0';
  }
}

// Compute sha256
export function sha256(buffer: Buffer): Buffer {
  return cryptoBrowser.createHash('sha256').update(buffer).digest();
}

// Compute Leaf Hash matching contract: sha256(name_xdr || value || salt)
export function computeLeaf(name: string, value: string, salt: Buffer): Buffer {
  const nameXdr = xdr.ScVal.scvSymbol(name).toXDR();
  const valueBuffer = Buffer.from(value, 'utf8');
  const concat = Buffer.concat([nameXdr, valueBuffer, salt]);
  return sha256(concat);
}

// Compute Parent Hash: sha256(concat(sorted(a, b)))
export function computeParent(a: Buffer, b: Buffer): Buffer {
  const concat = Buffer.compare(a, b) < 0 ? Buffer.concat([a, b]) : Buffer.concat([b, a]);
  return sha256(concat);
}

// A contract call argument: a prepared ScVal, a { value, type } descriptor, or a
// plain value (e.g. Buffer) that nativeToScVal can convert directly
export type ContractParam =
  | xdr.ScVal
  | { value: string; type: 'address' | 'symbol' | 'string' | 'bytes' | 'u32' | 'i32' | 'u64' | 'i64' | 'u128' | 'i128' }
  | Buffer;

// Accept either a ready xdr.ScVal or a plain { value, type } descriptor
function normalizeParam(param: ContractParam): xdr.ScVal {
  if (param instanceof xdr.ScVal) return param;
  if (param && typeof param === 'object' && 'value' in param && typeof param.type === 'string') {
    return nativeToScVal(param.value, { type: param.type });
  }
  return nativeToScVal(param);
}

// Build and simulate/prepare a transaction for Freighter to sign
export async function buildTransaction(
  sourceAddress: string,
  contractId: string,
  methodName: string,
  params: ContractParam[]
): Promise<string> {
  const account = await getSourceAccount(sourceAddress);
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: '500000', // high max fee to cover simulation
    networkPassphrase: Networks.TESTNET
  })
    .addOperation(contract.call(methodName, ...params.map(normalizeParam)))
    .setTimeout(60)
    .build();

  // Simulate to adjust fee and footprints automatically
  const serverUrl = 'https://soroban-testnet.stellar.org';
  const response = await fetch(serverUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'simulateTransaction',
      params: { transaction: tx.toXDR() }
    })
  });

  if (!response.ok) {
    throw new Error(`RPC Simulation request failed: ${response.statusText}`);
  }
  const result = await response.json();
  if (result.error) {
    throw new Error(`Simulation failed: ${JSON.stringify(result.error)}`);
  }
  if (result.result?.error) {
    throw new Error(`Simulation failed: ${result.result.error}`);
  }

  // If simulation is successful, assemble the transaction with the simulation
  // details (soroban data, resource fee, and auth entries)
  if (result.result && result.result.transactionData) {
    return rpc.assembleTransaction(tx, result.result).build().toXDR();
  }

  return tx.toXDR();
}

// Submit signed transaction to Soroban RPC
export async function submitTransaction(xdrString: string): Promise<string> {
  const serverUrl = 'https://soroban-testnet.stellar.org';
  const response = await fetch(serverUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: { transaction: xdrString }
    })
  });

  if (!response.ok) {
    throw new Error(`RPC sendTransaction failed: ${response.statusText}`);
  }
  const resData = await response.json();
  if (resData.error) {
    throw new Error(`Submission error: ${JSON.stringify(resData.error)}`);
  }
  if (resData.result.status === 'ERROR') {
    throw new Error(`Submission rejected: ${resData.result.errorResultXdr || JSON.stringify(resData.result)}`);
  }

  const hash = resData.result.hash;
  console.log(`Transaction submitted. Hash: ${hash}`);

  // Poll for completion; status stays NOT_FOUND until the tx is included in a ledger
  for (let attempts = 0; attempts < 20; attempts++) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const getRes = await fetch(serverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: { hash }
      })
    });
    const getResData = await getRes.json();
    const status = getResData.result?.status;
    if (status === 'SUCCESS') {
      return hash;
    }
    if (status === 'FAILED') {
      throw new Error(`Transaction failed: ${JSON.stringify(getResData.result.resultXdr)}`);
    }
    // NOT_FOUND (or a transient fetch hiccup): keep polling
  }

  throw new Error(`Transaction polling timeout. Hash: ${hash}`);
}

// Fetch the decoded return value of a completed transaction
export async function getTransactionReturnValue(hash: string): Promise<unknown> {
  const serverUrl = 'https://soroban-testnet.stellar.org';
  const response = await fetch(serverUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTransaction',
      params: { hash }
    })
  });
  if (!response.ok) {
    throw new Error(`getTransaction failed: ${response.statusText}`);
  }
  const data = await response.json();
  if (!data.result?.resultMetaXdr) return null;
  const meta = xdr.TransactionMeta.fromXDR(data.result.resultMetaXdr, 'base64');
  let retval: xdr.ScVal | null | undefined = null;
  if (meta.switch() === 3) {
    retval = meta.v3().sorobanMeta()?.returnValue();
  } else if (meta.switch() === 4) {
    retval = meta.v4().sorobanMeta()?.returnValue();
  }
  return retval ? scValToNative(retval) : null;
}

export async function invokeReadOnly<T = unknown>(
  contractId: string,
  methodName: string,
  params: ContractParam[]
): Promise<T | null> {
  const contract = new Contract(contractId);
  const dummyAccount = new Account('GAKF7GXDBJS2MMMVFHE4UNEKXJM3BABM3DQCSTF3JKRKN5WZI4GW4TIV', '0');
  
  const tx = new TransactionBuilder(dummyAccount, {
    fee: '100000',
    networkPassphrase: Networks.TESTNET
  })
    .addOperation(contract.call(methodName, ...params.map(normalizeParam)))
    .setTimeout(30)
    .build();

  const serverUrl = 'https://soroban-testnet.stellar.org';
  const response = await fetch(serverUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'simulateTransaction',
      params: { transaction: tx.toXDR() }
    })
  });

  if (!response.ok) {
    throw new Error(`RPC simulation failed: ${response.statusText}`);
  }
  const result = await response.json();
  if (result.error) {
    throw new Error(`RPC simulation failed: ${JSON.stringify(result.error)}`);
  }
  if (result.result?.error) {
    throw new Error(`RPC simulation failed: ${result.result.error}`);
  }

  const retvalXdr = result.result?.results?.[0]?.xdr;
  if (retvalXdr) {
    const rawRetval = xdr.ScVal.fromXDR(retvalXdr, 'base64');
    return scValToNative(rawRetval);
  }
  return null;
}

export async function registerUserAsIssuer(userAddress: string) {
  const deployerKey = 'SAU754I2KED4CIBM5KSOIJASMRUBV4ALZT3FYBVOTAAJFTE6F32PXK5P';
  const deployerKeyPair = Keypair.fromSecret(deployerKey);
  const deployerAddress = deployerKeyPair.publicKey();
  
  const account = await getSourceAccount(deployerAddress);
  const contract = new Contract(REGISTRY_ID);
  
  const tx = new TransactionBuilder(account, {
    fee: '500000',
    networkPassphrase: Networks.TESTNET
  })
    .addOperation(contract.call('register_issuer', Address.fromString(userAddress).toScVal(), nativeToScVal('DemoIssuer', { type: 'symbol' })))
    .setTimeout(60)
    .build();

  // Simulate
  const serverUrl = 'https://soroban-testnet.stellar.org';
  const response = await fetch(serverUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'simulateTransaction',
      params: { transaction: tx.toXDR() }
    })
  });
  const result = await response.json();
  if (result.result?.error) {
    throw new Error(`Issuer registration simulation failed: ${result.result.error}`);
  }
  if (result.result && result.result.transactionData) {
    const simTx = rpc.assembleTransaction(tx, result.result).build();
    simTx.sign(deployerKeyPair);
    return await submitTransaction(simTx.toXDR());
  }
  throw new Error("Issuer registration simulation failed");
}

export async function getLatestLedger(): Promise<number> {
  const serverUrl = 'https://soroban-testnet.stellar.org';
  const response = await fetch(serverUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getLatestLedger'
    })
  });
  
  if (!response.ok) {
    throw new Error(`getLatestLedger RPC request failed: ${response.statusText}`);
  }
  const result = await response.json();
  if (result.error) {
    throw new Error(`getLatestLedger failed: ${JSON.stringify(result.error)}`);
  }
  return result.result?.sequence || 0;
}

// Shape of an event entry returned by the getEvents RPC method
export interface ContractEvent {
  id: string;
  topic: string[];
  ledgerClosedAt?: string;
}

export async function getContractEvents(
  contractId: string,
  startLedger: number
): Promise<ContractEvent[]> {
  const serverUrl = 'https://soroban-testnet.stellar.org';
  const response = await fetch(serverUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getEvents',
      params: {
        startLedger,
        filters: [
          {
            type: 'contract',
            contractIds: [contractId]
          }
        ]
      }
    })
  });
  
  if (!response.ok) {
    throw new Error(`getEvents RPC request failed: ${response.statusText}`);
  }
  const result = await response.json();
  if (result.error) {
    throw new Error(`getEvents failed: ${JSON.stringify(result.error)}`);
  }
  return result.result?.events || [];
}
