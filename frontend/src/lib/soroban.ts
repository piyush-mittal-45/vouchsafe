import {
  Contract,
  TransactionBuilder,
  Account,
  Networks,
  Address,
  xdr,
  nativeToScVal,
  scValToNative,
  Keypair
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
    const balance = data.balances.find((b: any) => b.asset_type === 'native');
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

// Build and simulate/prepare a transaction for Freighter to sign
export async function buildTransaction(
  sourceAddress: string,
  contractId: string,
  methodName: string,
  params: any[]
): Promise<string> {
  const account = await getSourceAccount(sourceAddress);
  const contract = new Contract(contractId);
  
  const tx = new TransactionBuilder(account, {
    fee: '500000', // high max fee to cover simulation
    networkPassphrase: Networks.TESTNET
  })
    .addOperation(contract.call(methodName, ...params))
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
      params: [tx.toXDR()]
    })
  });
  
  if (!response.ok) {
    throw new Error(`RPC Simulation request failed: ${response.statusText}`);
  }
  const result = await response.json();
  if (result.error) {
    throw new Error(`Simulation failed: ${JSON.stringify(result.error)}`);
  }
  
  // If simulation is successful, reconstruct the transaction with the simulation details
  if (result.result && result.result.transactionData) {
    const simTx = TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET) as any;
    // Set footprints
    const txData = xdr.SorobanTransactionData.fromXDR(result.result.transactionData, 'base64');
    simTx.setSorobanData(txData);
    
    // Add exact simulation resource fees
    const minFee = parseInt(result.result.minResourceFee) + 10000;
    simTx.setFee((parseInt(simTx.fee) + minFee).toString());
    
    return simTx.toXDR();
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
      params: [xdrString]
    })
  });

  if (!response.ok) {
    throw new Error(`RPC sendTransaction failed: ${response.statusText}`);
  }
  const resData = await response.json();
  if (resData.error) {
    throw new Error(`Submission error: ${JSON.stringify(resData.error)}`);
  }

  const hash = resData.result.hash;
  console.log(`Transaction submitted. Hash: ${hash}`);

  // Poll for completion
  let status = resData.result.status;
  let attempts = 0;
  while (status === 'PENDING' && attempts < 10) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const getRes = await fetch(serverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: [hash]
      })
    });
    const getResData = await getRes.json();
    if (getResData.result) {
      status = getResData.result.status;
      if (status === 'SUCCESS') {
        return hash;
      }
      if (status === 'FAILED') {
        throw new Error(`Transaction failed: ${JSON.stringify(getResData.result.resultXdr)}`);
      }
    }
    attempts++;
  }

  if (status === 'SUCCESS') return hash;
  throw new Error(`Transaction polling timeout. Hash: ${hash}`);
}

export async function invokeReadOnly(
  contractId: string,
  methodName: string,
  params: any[]
): Promise<any> {
  const contract = new Contract(contractId);
  const dummyAccount = new Account('GAKF7GXDBJS2MMMVFHE4UNEKXJM3BABM3DQCSTF3JKRKN5WZI4GW4TIV', '0');
  
  const tx = new TransactionBuilder(dummyAccount, {
    fee: '100000',
    networkPassphrase: Networks.TESTNET
  })
    .addOperation(contract.call(methodName, ...params))
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
      params: [tx.toXDR()]
    })
  });
  
  if (!response.ok) {
    throw new Error(`RPC simulation failed: ${response.statusText}`);
  }
  const result = await response.json();
  if (result.error) {
    throw new Error(`RPC simulation failed: ${JSON.stringify(result.error)}`);
  }
  
  if (result.result && result.result.retval) {
    const rawRetval = xdr.ScVal.fromXDR(result.result.retval, 'base64');
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
      params: [tx.toXDR()]
    })
  });
  const result = await response.json();
  if (result.result && result.result.transactionData) {
    const simTx = TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET) as any;
    const txData = xdr.SorobanTransactionData.fromXDR(result.result.transactionData, 'base64');
    simTx.setSorobanData(txData);
    const minFee = parseInt(result.result.minResourceFee) + 10000;
    simTx.setFee((parseInt(simTx.fee) + minFee).toString());
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
      method: 'getLatestLedger',
      params: []
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

export async function getContractEvents(
  contractId: string,
  startLedger: number
): Promise<any[]> {
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
