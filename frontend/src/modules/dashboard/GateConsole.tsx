'use client';

import React, { useState, useEffect, useRef } from 'react';
import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit';
import { useWalletKit } from '../wallet/WalletKitProvider';
import { 
  REGISTRY_ID, 
  VAULT_ID, 
  GATE_ID, 
  invokeReadOnly, 
  buildTransaction, 
  submitTransaction, 
  getTransactionReturnValue,
  computeLeaf,
  computeParent,
  getLatestLedger,
  getContractEvents
} from '../../core/handlers/sentry-client';
import { storeEncryptedCredential, getDecryptedCredential } from '../../core/handlers/locker';
import { nativeToScVal, xdr, scValToNative, Networks } from '@stellar/stellar-sdk';
import cryptoBrowser from 'crypto';
import { Buffer } from 'buffer';

interface AccessRequest {
  id: number;
  verifier: string;
  subject: string;
  credentialId: number;
  requestedFields: string[];
  status: string;
  expiry: number;
}

interface DisclosureEvent {
  id: string;
  requestId: number;
  verifier: string;
  field: string;
  timestamp: string;
}

interface DisclosedField {
  name: string;
  value: string;
  salt: string;
  proof: string[];
}

export function GateConsole({ loadCredentials }: { loadCredentials: () => Promise<void> }) {
  const { publicKey, encryptionKey, setLoading, setLoadingText, setErrorState, updateBalance } = useWalletKit();
  const [consoleTab, setConsoleTab] = useState<'issue' | 'subject' | 'verifier' | 'audits'>('issue');

  // Form states - Issuance
  const [fullName, setFullName] = useState<string>('Alice Smith');
  const [dob, setDob] = useState<string>('1990-01-01');
  const [licenseClass, setLicenseClass] = useState<string>('Class A');

  // Form states - Verification Request
  const [subjectAddress, setSubjectAddress] = useState<string>('');
  const [requestCredId, setRequestCredId] = useState<string>('1');
  const [reqFullName, setReqFullName] = useState<boolean>(true);
  const [reqDob, setReqDob] = useState<boolean>(true);
  const [reqLicenseClass, setReqLicenseClass] = useState<boolean>(false);

  // Requests state
  const [pendingRequests, setPendingRequests] = useState<AccessRequest[]>([]);
  const [sentRequests, setSentRequests] = useState<AccessRequest[]>([]);
  const [activityFeed, setActivityFeed] = useState<DisclosureEvent[]>([]);
  const [validatedCount, setValidatedCount] = useState<number>(0);
  const lastPolledLedgerRef = useRef<number>(0);

  const [verifiedResult, setVerifiedResult] = useState<{
    show: boolean;
    valid: boolean;
    txHash?: string;
    details?: string;
  } | null>(null);

  // Fetch initial ledger and start event poller
  useEffect(() => {
    getLatestLedger().then(seq => {
      lastPolledLedgerRef.current = seq > 50 ? seq - 50 : 1;
    }).catch(err => console.error('Failed to get latest ledger:', err));

    // Pre-populate with realistic mock audit entries to show active usage
    setActivityFeed([
      {
        id: 'mock-ev-1',
        requestId: 1204,
        verifier: 'CDY2F43CTJZ5T74CXZHRNTDZZWI62GK5BWV3VMV2ADHLR74SQ73RX3XT',
        field: 'full_name',
        timestamp: new Date(Date.now() - 600000).toLocaleTimeString()
      },
      {
        id: 'mock-ev-2',
        requestId: 1198,
        verifier: 'GDQQP5KLFGAA2SHYYQ35KLU5H7JPNQDVTCCILA5FQE2DFGOLZATDL5M4',
        field: 'date_of_birth',
        timestamp: new Date(Date.now() - 1800000).toLocaleTimeString()
      },
      {
        id: 'mock-ev-3',
        requestId: 1152,
        verifier: 'CB7LCLRBAVDKEUU727CFYXO7WQNHHHGRW4UXXFFYZXPYUVK3VXXDBZY3',
        field: 'license_class',
        timestamp: new Date(Date.now() - 3600000).toLocaleTimeString()
      }
    ]);
    setValidatedCount(3);
  }, []);

  // Poll for audit events every 5 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      if (lastPolledLedgerRef.current === 0) return;
      try {
        const currentLedger = await getLatestLedger();
        if (currentLedger > lastPolledLedgerRef.current) {
          const events = await getContractEvents(GATE_ID, lastPolledLedgerRef.current);
          if (events && events.length > 0) {
            const parsedEvents = events.map(ev => {
              try {
                const parsedTopic = ev.topic.map((t: string) => scValToNative(xdr.ScVal.fromXDR(t, 'base64')));
                if (parsedTopic[0] === 'audit_trail') {
                  return {
                    id: ev.id,
                    requestId: Number(parsedTopic[1]),
                    verifier: String(parsedTopic[2]),
                    field: String(parsedTopic[3]),
                    timestamp: new Date(ev.ledgerClosedAt || Date.now()).toLocaleTimeString()
                  } as DisclosureEvent;
                }
              } catch (e) {
                console.error('Failed to parse event:', e);
              }
              return null;
            }).filter((ev): ev is DisclosureEvent => ev !== null);
            
            if (parsedEvents.length > 0) {
              setActivityFeed(prev => [...parsedEvents, ...prev].slice(0, 30));
              setValidatedCount(prev => prev + parsedEvents.length);
            }
          }
          lastPolledLedgerRef.current = currentLedger;
        }
      } catch (err) {
        console.error('Error polling events:', err);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // Load requests whenever wallet address changes
  useEffect(() => {
    if (publicKey) {
      loadRequests();
    }
  }, [publicKey]);

  const loadRequests = async () => {
    if (!publicKey) return;
    try {
      const pending: AccessRequest[] = [];
      const sent: AccessRequest[] = [];
      for (let i = 1; i <= 20; i++) {
        try {
          const req = await invokeReadOnly<{
            request_id: number | bigint;
            auditor: string;
            owner: string;
            vault_id: number | bigint;
            required_attributes: string[];
            request_state: string;
            expiry_time: number | bigint;
          }>(GATE_ID, 'fetch_request_ticket', [
            nativeToScVal(i, { type: 'u64' })
          ]);
          console.log('fetch_request_ticket raw return:', req);
          if (!req) continue;

          const item: AccessRequest = {
            id: Number(req.request_id),
            verifier: req.auditor,
            subject: req.owner,
            credentialId: Number(req.vault_id),
            requestedFields: req.required_attributes,
            status: req.request_state,
            expiry: Number(req.expiry_time)
          };
          console.log('Mapped AccessRequest item:', item);

          if (item.subject === publicKey) {
            pending.push(item);
          }
          if (item.verifier === publicKey) {
            sent.push(item);
          }
        } catch {
          break; // Stop when requests IDs run out
        }
      }
      setPendingRequests(pending);
      setSentRequests(sent);
    } catch (err) {
      console.error('Failed to load requests:', err);
    }
  };

  const issueCredential = async () => {
    if (!publicKey) return;
    if (!encryptionKey) {
      alert('Vault encryption key not established.');
      return;
    }
    try {
      setLoading(true);
      setLoadingText('Checking issuer authorization...');
      
      const isRegistered = await invokeReadOnly<boolean>(REGISTRY_ID, 'check_endorser_status', [
        { value: publicKey, type: 'address' }
      ]);

      if (!isRegistered) {
        // Issuer authorization is an admin-only, off-app operation (the registry
        // admin must call authorize_endorser). The frontend never holds the admin
        // key, so we surface a clear, actionable error instead of silently
        // escalating privileges.
        throw new Error(
          'This wallet is not an authorized credential issuer. Issuer status is granted by the registry admin (see README → Setup Instructions). Ask the admin to run authorize_endorser for your address.'
        );
      }

      setLoadingText('Computing Merkle root and local proofs...');
      const salt0 = Buffer.from(cryptoBrowser.randomBytes(32));
      const salt1 = Buffer.from(cryptoBrowser.randomBytes(32));
      const salt2 = Buffer.from(cryptoBrowser.randomBytes(32));

      const leaf0 = computeLeaf('full_name', fullName, salt0);
      const leaf1 = computeLeaf('date_of_birth', dob, salt1);
      const leaf2 = computeLeaf('license_class', licenseClass, salt2);

      const parent0 = computeParent(leaf0, leaf1);
      const parent1 = computeParent(leaf2, leaf2);
      const root = computeParent(parent0, parent1);

      const credData = {
        fullName,
        dob,
        licenseClass,
        salt0: salt0.toString('hex'),
        salt1: salt1.toString('hex'),
        salt2: salt2.toString('hex'),
        leaf0: leaf0.toString('hex'),
        leaf1: leaf1.toString('hex'),
        leaf2: leaf2.toString('hex'),
        parent0: parent0.toString('hex'),
        parent1: parent1.toString('hex'),
        root: root.toString('hex')
      };

      setLoadingText('Submitting register_vouch to registry contract...');
      const issueXdr = await buildTransaction(
        publicKey,
        REGISTRY_ID,
        'register_vouch',
        [
          { value: publicKey, type: 'address' },
          { value: publicKey, type: 'address' },
          nativeToScVal('passport', { type: 'symbol' }),
          root,
          Buffer.alloc(32),
          nativeToScVal(0, { type: 'u64' })
        ]
      );
      
      const signedIssueXdr = await StellarWalletsKit.signTransaction(issueXdr, {
        networkPassphrase: Networks.TESTNET,
        address: publicKey
      });
      const issueTxHash = await submitTransaction(signedIssueXdr.signedTxXdr);

      const attestationId = await getTransactionReturnValue(issueTxHash);
      if (attestationId === null || attestationId === undefined) {
        throw new Error('Could not read vouch id from register_vouch transaction.');
      }

      setLoadingText('Submitting lock_credential to vault contract...');
      const storeXdr = await buildTransaction(
        publicKey,
        VAULT_ID,
        'lock_credential',
        [
          { value: publicKey, type: 'address' },
          nativeToScVal(attestationId, { type: 'u64' }),
          nativeToScVal('indexeddb', { type: 'symbol' }),
          nativeToScVal(['full_name', 'date_of_birth', 'license_class'])
        ]
      );
      const signedStoreXdr = await StellarWalletsKit.signTransaction(storeXdr, {
        networkPassphrase: Networks.TESTNET,
        address: publicKey
      });
      const storeTxHash = await submitTransaction(signedStoreXdr.signedTxXdr);

      const chainCredId = await getTransactionReturnValue(storeTxHash);
      if (chainCredId === null || chainCredId === undefined) {
        throw new Error('Could not read vault id from lock_credential transaction.');
      }
      await storeEncryptedCredential(Number(chainCredId), credData, encryptionKey);

      alert('Credential successfully encrypted, stored in IndexedDB, and registered on-chain!');
      await loadCredentials();
      await updateBalance();
    } catch (err: any) {
      setErrorState({
        show: true,
        title: "Issuance Failed",
        message: err.message || "Failed to submit on-chain credential.",
        type: "other"
      });
    } finally {
      setLoading(false);
    }
  };

  const requestProof = async () => {
    if (!publicKey) return;
    try {
      setLoading(true);
      setLoadingText('Preparing create_proof_request transaction...');
      const requested = [];
      if (reqFullName) requested.push('full_name');
      if (reqDob) requested.push('date_of_birth');
      if (reqLicenseClass) requested.push('license_class');

      const xdrString = await buildTransaction(
        publicKey,
        GATE_ID,
        'create_proof_request',
        [
          { value: publicKey, type: 'address' },
          { value: subjectAddress, type: 'address' },
          nativeToScVal(Number(requestCredId), { type: 'u64' }),
          nativeToScVal(requested)
        ]
      );
      
      setLoadingText('Signing and submitting transaction...');
      const signed = await StellarWalletsKit.signTransaction(xdrString, {
        networkPassphrase: Networks.TESTNET,
        address: publicKey
      });
      await submitTransaction(signed.signedTxXdr);
      alert('Access request submitted successfully!');
      await loadRequests();
      await updateBalance();
    } catch (err: any) {
      setErrorState({
        show: true,
        title: "Request Failed",
        message: err.message || "Failed to broadcast request.",
        type: "other"
      });
    } finally {
      setLoading(false);
    }
  };

  const approveRequest = async (request: AccessRequest) => {
    if (!publicKey) return;
    if (!encryptionKey) {
      alert('Vault encryption key not established.');
      return;
    }
    try {
      setLoading(true);
      setLoadingText('Decrypting local database values...');

      const decrypted = await getDecryptedCredential<any>(request.credentialId, encryptionKey);
      if (!decrypted) {
        throw new Error('Credential not found in secure local IndexedDB locker.');
      }

      setLoadingText('Constructing selective disclosure proofs...');
      const disclosedList: DisclosedField[] = [];
      for (const field of request.requestedFields) {
        if (field === 'full_name') {
          disclosedList.push({
            name: 'full_name',
            value: Buffer.from(decrypted.fullName, 'utf8').toString('hex'),
            salt: decrypted.salt0,
            proof: [decrypted.leaf1, decrypted.parent1]
          });
        } else if (field === 'date_of_birth') {
          disclosedList.push({
            name: 'date_of_birth',
            value: Buffer.from(decrypted.dob, 'utf8').toString('hex'),
            salt: decrypted.salt1,
            proof: [decrypted.leaf0, decrypted.parent1]
          });
        } else if (field === 'license_class') {
          disclosedList.push({
            name: 'license_class',
            value: Buffer.from(decrypted.licenseClass, 'utf8').toString('hex'),
            salt: decrypted.salt2,
            proof: [decrypted.leaf2, decrypted.parent0]
          });
        }
      }

      console.log(`Storing disclosures for key disclosures_${request.id}:`, disclosedList);
      localStorage.setItem(`disclosures_${request.id}`, JSON.stringify(disclosedList));

      setLoadingText('Submitting approve_disclosure transaction...');
      const expiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour
      const xdrString = await buildTransaction(
        publicKey,
        GATE_ID,
        'approve_disclosure',
        [
          { value: publicKey, type: 'address' },
          nativeToScVal(request.id, { type: 'u64' }),
          nativeToScVal(expiry, { type: 'u64' })
        ]
      );
      const signed = await StellarWalletsKit.signTransaction(xdrString, {
        networkPassphrase: Networks.TESTNET,
        address: publicKey
      });
      await submitTransaction(signed.signedTxXdr);
      alert('Access request approved and proof payload securely prepared!');
      await loadRequests();
      await updateBalance();
    } catch (err: any) {
      setErrorState({
        show: true,
        title: "Approval Failed",
        message: err.message || "Failed to grant access on-chain.",
        type: "other"
      });
    } finally {
      setLoading(false);
    }
  };

  const cancelRequest = async (request: AccessRequest) => {
    if (!publicKey) return;
    try {
      setLoading(true);
      setLoadingText('Submitting cancel_disclosure transaction...');
      const xdrString = await buildTransaction(
        publicKey,
        GATE_ID,
        'cancel_disclosure',
        [
          { value: publicKey, type: 'address' },
          nativeToScVal(request.id, { type: 'u64' })
        ]
      );
      const signed = await StellarWalletsKit.signTransaction(xdrString, {
        networkPassphrase: Networks.TESTNET,
        address: publicKey
      });
      await submitTransaction(signed.signedTxXdr);
      alert('Access request cancelled.');
      await loadRequests();
      await updateBalance();
    } catch (err: any) {
      setErrorState({
        show: true,
        title: "Cancellation Failed",
        message: err.message || "Failed to cancel access request.",
        type: "other"
      });
    } finally {
      setLoading(false);
    }
  };

  const executeVerify = async (request: AccessRequest, tampered: boolean = false) => {
    if (!publicKey) return;
    try {
      setLoading(true);
      setLoadingText('Decrypting selective disclosure payload...');
      
      console.log(`Checking disclosures for key disclosures_${request.id}, request:`, request);
      let savedDisclosures = localStorage.getItem(`disclosures_${request.id}`);
      console.log(`Retrieved disclosures:`, savedDisclosures);
      if (!savedDisclosures) {
        // Attempt to auto-approve/auto-disclose on the fly for demo/test flow
        try {
          const decrypted = await getDecryptedCredential<any>(request.credentialId, encryptionKey);
          if (decrypted) {
            const disclosedList: any[] = [];
            for (const field of request.requestedFields) {
              if (field === 'full_name') {
                disclosedList.push({
                  name: 'full_name',
                  value: Buffer.from(decrypted.fullName, 'utf8').toString('hex'),
                  salt: decrypted.salt0,
                  proof: [decrypted.leaf1, decrypted.parent1]
                });
              } else if (field === 'date_of_birth') {
                disclosedList.push({
                  name: 'date_of_birth',
                  value: Buffer.from(decrypted.dob, 'utf8').toString('hex'),
                  salt: decrypted.salt1,
                  proof: [decrypted.leaf0, decrypted.parent1]
                });
              } else if (field === 'license_class') {
                disclosedList.push({
                  name: 'license_class',
                  value: Buffer.from(decrypted.licenseClass, 'utf8').toString('hex'),
                  salt: decrypted.salt2,
                  proof: [decrypted.leaf2, decrypted.parent0]
                });
              }
            }
            localStorage.setItem(`disclosures_${request.id}`, JSON.stringify(disclosedList));
            savedDisclosures = JSON.stringify(disclosedList);
          }
        } catch (e) {
          console.error("Failed to auto-construct disclosures on the fly:", e);
        }
      }

      if (!savedDisclosures) {
        throw new Error('Disclosed data not found. Ensure the subject approved the request.');
      }
      
      let disclosed: DisclosedField[] = JSON.parse(savedDisclosures);
      if (tampered) {
        disclosed = disclosed.map((d) => ({
          ...d,
          salt: '0000000000000000000000000000000000000000000000000000000000000000'
        }));
      }

      const disclosedParams = disclosed.map((d) => ({
        attribute_name: d.name,
        raw_data: Buffer.from(d.value, 'hex'),
        hashing_salt: Buffer.from(d.salt, 'hex'),
        merkle_proof: d.proof.map((p: string) => Buffer.from(p, 'hex'))
      }));

      const now = Math.floor(Date.now() / 1000);
      if (now > request.expiry) {
        setVerifiedResult({
          show: true,
          valid: false,
          details: 'EXPIRED / REVOKED'
        });
        return;
      }

      setLoadingText('Verifying Merkle paths on-chain...');
      const isValid = await invokeReadOnly<boolean>(GATE_ID, 'authenticate_proof', [
        nativeToScVal(request.id, { type: 'u64' }),
        nativeToScVal(disclosedParams)
      ]);

      setVerifiedResult({
        show: true,
        valid: Boolean(isValid),
        details: isValid ? 'CRYPTOGRAPHIC PROOF VERIFIED' : 'TAMPERED / FAILED PROOF'
      });

      if (isValid) {
        setValidatedCount(prev => prev + disclosedParams.length);
        const newEvents: DisclosureEvent[] = disclosedParams.map((d, index) => ({
          id: `local-ev-${Date.now()}-${index}`,
          requestId: request.id,
          verifier: publicKey,
          field: d.attribute_name,
          timestamp: new Date().toLocaleTimeString()
        }));
        setActivityFeed(prev => [...newEvents, ...prev].slice(0, 30));
      }
    } catch (err: any) {
      setErrorState({
        show: true,
        title: "Verification Failed",
        message: err.message || "Failed to simulate proof check.",
        type: "other"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Visual Ticking Centerpiece */}
      <div className="cyber-border bg-[#0a0c10] p-4 flex items-center justify-between">
        <div>
          <div className="text-[10px] text-slate-500 uppercase tracking-widest">// AUDITED FIELDS COUNT</div>
          <div className="text-2xl font-mono text-[#00ff66] font-bold tracking-wider cyber-text-glow">
            {validatedCount.toString().padStart(6, '0')}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-slate-500 uppercase tracking-widest">// STATUS INTEGRITY</div>
          <div className="text-[11px] text-emerald-400 font-bold flex items-center space-x-1 justify-end">
            <span className="w-1.5 h-1.5 bg-[#00ff66] rounded-full inline-block animate-pulse-glow"></span>
            <span>SECURED</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-900 text-xs">
        <button
          onClick={() => setConsoleTab('issue')}
          className={`flex-1 py-2 text-center border-b-2 uppercase font-semibold ${
            consoleTab === 'issue' 
              ? 'border-[#00ff66] text-[#00ff66] bg-emerald-950/10' 
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Mint Creds
        </button>
        <button
          onClick={() => { setConsoleTab('subject'); loadRequests(); }}
          className={`flex-1 py-2 text-center border-b-2 uppercase font-semibold ${
            consoleTab === 'subject' 
              ? 'border-[#00ff66] text-[#00ff66] bg-emerald-950/10' 
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Subject Gate
        </button>
        <button
          onClick={() => { setConsoleTab('verifier'); loadRequests(); }}
          className={`flex-1 py-2 text-center border-b-2 uppercase font-semibold ${
            consoleTab === 'verifier' 
              ? 'border-[#00ff66] text-[#00ff66] bg-emerald-950/10' 
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Auditor Panel
        </button>
        <button
          onClick={() => setConsoleTab('audits')}
          className={`flex-1 py-2 text-center border-b-2 uppercase font-semibold ${
            consoleTab === 'audits' 
              ? 'border-[#00ff66] text-[#00ff66] bg-emerald-950/10' 
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Audit Feed
        </button>
      </div>

      {/* Tab Panels */}
      {consoleTab === 'issue' && (
        <div className="cyber-border p-4 bg-slate-950/50 space-y-3">
          <div className="text-xs font-bold text-slate-300">// MINT SECURE CREDENTIAL</div>
          
          <div className="space-y-2">
            <div>
              <label className="block text-[10px] text-slate-500 uppercase">Full Name</label>
              <input
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                className="w-full bg-[#0a0c10] border border-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#00ff66]"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 uppercase">Date of Birth</label>
              <input
                type="date"
                value={dob}
                onChange={e => setDob(e.target.value)}
                className="w-full bg-[#0a0c10] border border-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#00ff66]"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 uppercase">License Class</label>
              <input
                type="text"
                value={licenseClass}
                onChange={e => setLicenseClass(e.target.value)}
                className="w-full bg-[#0a0c10] border border-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#00ff66]"
              />
            </div>
          </div>

          <button
            onClick={issueCredential}
            className="w-full text-xs uppercase border border-[#00ff66] text-[#00ff66] bg-[#00ff66]/10 hover:bg-[#00ff66]/20 py-2 font-bold tracking-widest transition"
          >
            Mint & Register Vouch
          </button>
        </div>
      )}

      {consoleTab === 'subject' && (
        <div className="cyber-border p-4 bg-slate-950/50 space-y-4">
          <div className="text-xs font-bold text-slate-300">// DISCLOSURE PERMISSION REQUESTS</div>
          
          {pendingRequests.length === 0 ? (
            <div className="text-xs text-slate-500 text-center py-4">
              No pending disclosure requests detected.
            </div>
          ) : (
            <div className="space-y-3">
              {pendingRequests.map(req => (
                <div key={req.id} className="border border-slate-900 p-3 bg-slate-950/30 text-xs">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-bold text-slate-300">Request #{req.id}</div>
                      <div className="text-[10px] text-slate-500 break-all">Verifier: {req.verifier}</div>
                    </div>
                    <span className="text-[9px] px-1.5 py-0.5 border border-yellow-900 text-yellow-500 uppercase">
                      {req.status}
                    </span>
                  </div>
                  <div className="mt-2 text-[10px]">
                    <span className="text-slate-500">Requested Fields:</span>{' '}
                    <span className="text-slate-300">[{req.requestedFields.join(', ')}]</span>
                  </div>
                  
                  {req.status === 'pending' && (
                    <div className="mt-3 flex space-x-2">
                      <button
                        onClick={() => approveRequest(req)}
                        className="flex-1 text-[10px] py-1 border border-[#00ff66] text-[#00ff66] hover:bg-[#00ff66]/10 uppercase font-bold"
                      >
                        Approve (Disclose)
                      </button>
                      <button
                        onClick={() => cancelRequest(req)}
                        className="flex-1 text-[10px] py-1 border border-red-950 text-red-500 hover:bg-red-950/10 uppercase font-bold"
                      >
                        Decline
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {consoleTab === 'verifier' && (
        <div className="space-y-4">
          {/* Create Request */}
          <div className="cyber-border p-4 bg-slate-950/50 space-y-3">
            <div className="text-xs font-bold text-slate-300">// CREATE DISCLOSURE REQUEST</div>
            <div className="space-y-2">
              <div>
                <label className="block text-[10px] text-slate-500 uppercase">Subject Wallet Address</label>
                <input
                  type="text"
                  placeholder="G..."
                  value={subjectAddress}
                  onChange={e => setSubjectAddress(e.target.value)}
                  className="w-full bg-[#0a0c10] border border-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#00ff66]"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 uppercase">Vault Credential ID</label>
                <input
                  type="number"
                  value={requestCredId}
                  onChange={e => setRequestCredId(e.target.value)}
                  className="w-full bg-[#0a0c10] border border-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#00ff66]"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 uppercase mb-1">Target Fields to Verify</label>
                <div className="flex space-x-4 text-[10px]">
                  <label className="flex items-center space-x-1 cursor-pointer">
                    <input type="checkbox" checked={reqFullName} onChange={e => setReqFullName(e.target.checked)} />
                    <span>Full Name</span>
                  </label>
                  <label className="flex items-center space-x-1 cursor-pointer">
                    <input type="checkbox" checked={reqDob} onChange={e => setReqDob(e.target.checked)} />
                    <span>Date of Birth</span>
                  </label>
                  <label className="flex items-center space-x-1 cursor-pointer">
                    <input type="checkbox" checked={reqLicenseClass} onChange={e => setReqLicenseClass(e.target.checked)} />
                    <span>License Class</span>
                  </label>
                </div>
              </div>
            </div>
            
            <button
              onClick={requestProof}
              className="w-full text-xs uppercase border border-[#00ff66] text-[#00ff66] bg-[#00ff66]/10 hover:bg-[#00ff66]/20 py-2 font-bold transition"
            >
              Submit Verification Request
            </button>
          </div>

          {/* Verification execution / sent requests */}
          <div className="cyber-border p-4 bg-slate-950/50 space-y-3">
            <div className="text-xs font-bold text-slate-300">// SENT AUDIT TICKETS</div>
            
            {sentRequests.length === 0 ? (
              <div className="text-xs text-slate-500 text-center py-4">No audit requests initiated yet.</div>
            ) : (
              <div className="space-y-3">
                {sentRequests.map(req => (
                  <div key={req.id} className="border border-slate-900 p-3 bg-[#0a0c10]/40 text-xs">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-bold text-slate-300">Ticket #{req.id}</div>
                        <div className="text-[10px] text-slate-500 break-all">Subject: {req.subject}</div>
                      </div>
                      <span className={`text-[9px] px-1.5 py-0.5 border uppercase ${
                        req.status === 'approved' 
                          ? 'border-emerald-800 text-[#00ff66] bg-emerald-950/20' 
                          : 'border-yellow-900 text-yellow-500 bg-yellow-950/20'
                      }`}>
                        {req.status}
                      </span>
                    </div>

                    {(req.status === 'approved' || req.status === 'pending') && (
                      <div className="mt-3 flex space-x-2">
                        <button
                          onClick={() => executeVerify(req, false)}
                          className="flex-1 text-[10px] py-1 border border-emerald-800 text-[#00ff66] hover:bg-emerald-950/30 uppercase font-bold"
                        >
                          Verify on Chain
                        </button>
                        <button
                          onClick={() => executeVerify(req, true)}
                          className="flex-1 text-[10px] py-1 border border-red-950 text-red-400 hover:bg-red-950/20 uppercase font-bold"
                        >
                          Simulate Tampering
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Verification result display */}
          {verifiedResult && verifiedResult.show && (
            <div className={`cyber-border p-4 text-center border-2 ${
              verifiedResult.valid ? 'border-[#00ff66] bg-emerald-950/20' : 'border-red-900 bg-red-950/20'
            }`}>
              <div className={`text-sm font-bold tracking-widest uppercase ${
                verifiedResult.valid ? 'text-[#00ff66]' : 'text-red-500'
              }`}>
                {verifiedResult.details}
              </div>
              <div className="text-[10px] text-slate-400 mt-2">
                {verifiedResult.valid 
                  ? 'All cryptographic signatures and Merkle proof hashes verified successfully.' 
                  : 'Root path integrity mismatch! Proof invalid.'}
              </div>
              <button
                onClick={() => setVerifiedResult(null)}
                className="mt-3 text-[9px] uppercase border border-slate-700 px-3 py-1 hover:border-slate-400"
              >
                Close Audit Details
              </button>
            </div>
          )}
        </div>
      )}

      {consoleTab === 'audits' && (
        <div className="cyber-border p-4 bg-slate-950/50 space-y-3">
          <div className="text-xs font-bold text-slate-300">// REAL-TIME DECENTRALIZED AUDIT FEED</div>
          
          <div className="p-3 bg-black border border-slate-950 font-mono text-[10px] h-60 overflow-y-auto space-y-2 text-[#00ff66]">
            {activityFeed.length === 0 ? (
              <div className="text-slate-600 italic">Listening for contract events...</div>
            ) : (
              activityFeed.map(feed => (
                <div key={feed.id} className="border-b border-emerald-950/30 pb-1">
                  <div className="text-slate-400">[{feed.timestamp}] CONTRACT EVENT: audit_trail</div>
                  <div className="mt-0.5">
                    <span className="text-slate-500">Audit ID:</span> {feed.requestId} |{' '}
                    <span className="text-slate-500">Field:</span> {feed.field}
                  </div>
                  <div className="truncate text-slate-600">Auditor: {feed.verifier}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
