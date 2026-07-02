'use client';

import { useState, useEffect, useRef } from 'react';
import { Buffer } from 'buffer';
import cryptoBrowser from 'crypto';
import {
  StellarWalletsKit,
  Networks
} from '@creit.tech/stellar-wallets-kit';
import { nativeToScVal, xdr, scValToNative } from '@stellar/stellar-sdk';
import {
  REGISTRY_ID,
  VAULT_ID,
  ACCESS_ID,
  getXlmBalance,
  buildTransaction,
  submitTransaction,
  invokeReadOnly,
  registerUserAsIssuer,
  computeLeaf,
  computeParent,
  getLatestLedger,
  getContractEvents
} from '../lib/soroban';
import {
  deriveKeyFromSignature,
  storeEncryptedCredential,
  getDecryptedCredential
} from '../lib/storage';

export default function ClientHome() {
  const [publicKey, setPublicKey] = useState<string>('');
  const [balance, setBalance] = useState<string>('0.0');
  const [activeTab, setActiveTab] = useState<'subject' | 'verifier'>('subject');

  // Encryption Key derived from signature
  const [encryptionKey, setEncryptionKey] = useState<CryptoKey | null>(null);

  // Loading states
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingText, setLoadingText] = useState<string>('');

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

  // Loaded data
  const [credentials, setCredentials] = useState<any[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [sentRequests, setSentRequests] = useState<any[]>([]);
  
  // Real-time activity feed driven by events
  const [activityFeed, setActivityFeed] = useState<any[]>([]);
  const lastPolledLedgerRef = useRef<number>(0);

  const [verifiedResult, setVerifiedResult] = useState<{
    show: boolean;
    valid: boolean;
    txHash?: string;
  } | null>(null);

  // Initialize Stellar Wallet Kit on mount
  useEffect(() => {
    StellarWalletsKit.setNetwork(Networks.TESTNET);
    
    // Initialize starting ledger for events feed
    getLatestLedger().then(seq => {
      lastPolledLedgerRef.current = seq > 50 ? seq - 50 : 1; // start from recent ledgers
    }).catch(err => {
      console.error('Failed to get latest ledger:', err);
    });
  }, []);

  // Update balance and derive key when publicKey changes
  useEffect(() => {
    if (publicKey) {
      updateData();
      deriveEncryptionKeyFlow();
    }
  }, [publicKey]);

  // Set up event polling interval (every 5 seconds)
  useEffect(() => {
    const interval = setInterval(async () => {
      if (lastPolledLedgerRef.current === 0) return;
      try {
        const currentLedger = await getLatestLedger();
        if (currentLedger > lastPolledLedgerRef.current) {
          const events = await getContractEvents(ACCESS_ID, lastPolledLedgerRef.current);
          if (events && events.length > 0) {
            const parsedEvents = events.map(ev => {
              try {
                const parsedTopic = ev.topic.map((t: string) => scValToNative(xdr.ScVal.fromXDR(t, 'base64')));
                if (parsedTopic[0] === 'disclosure') {
                  return {
                    id: ev.id,
                    requestId: Number(parsedTopic[1]),
                    verifier: parsedTopic[2],
                    field: parsedTopic[3],
                    timestamp: new Date(ev.ledgerClosedAt || Date.now()).toLocaleTimeString()
                  };
                }
              } catch (e) {
                console.error('Failed to parse event:', e);
              }
              return null;
            }).filter(Boolean);
            
            if (parsedEvents.length > 0) {
              setActivityFeed(prev => [...parsedEvents, ...prev].slice(0, 30)); // limit feed size
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

  const deriveEncryptionKeyFlow = async () => {
    try {
      setLoading(true);
      setLoadingText('Requesting signature to derive secure local database key...');
      
      const challenge = 'Authorize VouchSafe local encrypted database access.';
      const signRes = await StellarWalletsKit.signMessage(challenge);
      
      if (!signRes || !signRes.signedMessage) {
        throw new Error('Wallet signature is required to open the vault.');
      }
      
      const derivedKey = await deriveKeyFromSignature(signRes.signedMessage);
      setEncryptionKey(derivedKey);
      alert('Local database encryption key successfully established!');
    } catch (err: any) {
      console.error(err);
      alert(`Vault key derivation failed: ${err.message || err}. You will not be able to issue or decrypt credentials.`);
      disconnectWallet();
    } finally {
      setLoading(false);
    }
  };

  const updateData = async () => {
    if (!publicKey) return;
    const bal = await getXlmBalance(publicKey);
    setBalance(bal);
    await loadCredentials();
    await loadRequests();
  };

  const connectWallet = async () => {
    try {
      setLoading(true);
      setLoadingText('Connecting Wallet...');
      const { address } = await StellarWalletsKit.authModal();
      setPublicKey(address);
    } catch (err) {
      console.error(err);
      alert('Failed to connect wallet');
    } finally {
      setLoading(false);
    }
  };

  const disconnectWallet = async () => {
    await StellarWalletsKit.disconnect();
    setPublicKey('');
    setBalance('0.0');
    setCredentials([]);
    setPendingRequests([]);
    setSentRequests([]);
    setEncryptionKey(null);
  };

  // Load Credentials owned by the user
  const loadCredentials = async () => {
    if (!publicKey) return;
    try {
      const ids: any[] = await invokeReadOnly(VAULT_ID, 'list_credentials', [
        { value: publicKey, type: 'address' }
      ]);
      
      if (!ids || ids.length === 0) {
        setCredentials([]);
        return;
      }

      const list = [];
      for (const idVal of ids) {
        const id = Number(idVal);
        const meta = await invokeReadOnly(VAULT_ID, 'get_credential_meta', [
          nativeToScVal(id, { type: 'u64' })
        ]);
        
        const isValid = await invokeReadOnly(REGISTRY_ID, 'is_valid', [
          nativeToScVal(meta.attestation_id, { type: 'u64' })
        ]);

        list.push({
          id,
          attestationId: Number(meta.attestation_id),
          pointer: meta.pointer,
          fieldNames: meta.field_names,
          createdAt: new Date(Number(meta.created_at) * 1000).toLocaleDateString(),
          isValid
        });
      }
      setCredentials(list);
    } catch (err) {
      console.error("Failed to load credentials:", err);
    }
  };

  // Load Access Requests
  const loadRequests = async () => {
    if (!publicKey) return;
    try {
      const pending = [];
      const sent = [];
      for (let i = 1; i <= 10; i++) {
        try {
          const req = await invokeReadOnly(ACCESS_ID, 'get_access_request', [
            nativeToScVal(i, { type: 'u64' })
          ]);
          if (req) {
            const formatted = {
              id: i,
              verifier: req.verifier,
              subject: req.subject,
              credentialId: Number(req.credential_id),
              requestedFields: req.requested_fields,
              status: req.status,
              expiry: Number(req.expiry)
            };
            if (req.subject === publicKey) {
              pending.push(formatted);
            }
            if (req.verifier === publicKey) {
              sent.push(formatted);
            }
          }
        } catch (e) {
          // ignore not found
        }
      }
      setPendingRequests(pending);
      setSentRequests(sent);
    } catch (err) {
      console.error(err);
    }
  };

  // Issuer flow (demo register self + issue)
  const issueCredentialFlow = async () => {
    if (!publicKey) return;
    if (!encryptionKey) {
      alert('Vault encryption key not established. Please reconnect your wallet to establish it.');
      return;
    }
    try {
      setLoading(true);
      setLoadingText('Checking Issuer Authorization...');
      
      const isRegistered = await invokeReadOnly(REGISTRY_ID, 'is_issuer', [
        { value: publicKey, type: 'address' }
      ]);

      if (!isRegistered) {
        setLoadingText('Registering wallet as Trusted Issuer (using Admin)...');
        await registerUserAsIssuer(publicKey);
        alert('Registered Freighter Wallet as an Issuer successfully on Testnet!');
      }

      setLoadingText('Computing Merkle Tree and Proofs...');
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

      setLoadingText('Submitting issue_attestation to Testnet...');
      const issueXdr = await buildTransaction(
        publicKey,
        REGISTRY_ID,
        'issue_attestation',
        [
          { value: publicKey, type: 'address' },
          { value: publicKey, type: 'address' },
          nativeToScVal('passport', { type: 'symbol' }),
          root,
          Buffer.alloc(32),
          nativeToScVal(0, { type: 'u64' })
        ]
      );
      const signedIssueXdr = await StellarWalletsKit.signTransaction(issueXdr);
      await submitTransaction(signedIssueXdr.signedTxXdr);

      // Determine next credential ID dynamically
      const nextCredId = credentials.length + 1;

      setLoadingText('Encrypting raw credential data and storing in IndexedDB...');
      await storeEncryptedCredential(nextCredId, credData, encryptionKey);

      setLoadingText('Submitting store_credential to Vault...');
      const storeXdr = await buildTransaction(
        publicKey,
        VAULT_ID,
        'store_credential',
        [
          { value: publicKey, type: 'address' },
          nativeToScVal(1, { type: 'u64' }), // Reference registry attestation ID 1
          nativeToScVal(nextCredId.toString(), { type: 'symbol' }), // On-chain pointer is only the ID reference
          nativeToScVal(['full_name', 'date_of_birth', 'license_class'])
        ]
      );
      const signedStoreXdr = await StellarWalletsKit.signTransaction(storeXdr);
      await submitTransaction(signedStoreXdr.signedTxXdr);

      alert('Credential successfully encrypted, stored in IndexedDB, and metadata registered in the vault!');
      await updateData();
    } catch (err: any) {
      console.error(err);
      alert(`Issuance failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Verifier: Create Request
  const createAccessRequest = async () => {
    if (!publicKey) return;
    try {
      setLoading(true);
      setLoadingText('Submitting request_proof transaction...');
      const requested = [];
      if (reqFullName) requested.push('full_name');
      if (reqDob) requested.push('date_of_birth');
      if (reqLicenseClass) requested.push('license_class');

      const xdrString = await buildTransaction(
        publicKey,
        ACCESS_ID,
        'request_proof',
        [
          { value: publicKey, type: 'address' },
          { value: subjectAddress, type: 'address' },
          nativeToScVal(Number(requestCredId), { type: 'u64' }),
          nativeToScVal(requested)
        ]
      );
      const signed = await StellarWalletsKit.signTransaction(xdrString);
      await submitTransaction(signed.signedTxXdr);
      alert('Access request submitted successfully!');
      await updateData();
    } catch (err: any) {
      console.error(err);
      alert(`Request failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Subject: Grant Request (Decrypt and disclose proofs)
  const grantAccess = async (request: any) => {
    if (!publicKey) return;
    if (!encryptionKey) {
      alert('Vault encryption key not established.');
      return;
    }
    try {
      setLoading(true);
      setLoadingText('Retrieving and decrypting raw credential from IndexedDB...');
      
      const decrypted = await getDecryptedCredential(request.credentialId, encryptionKey);
      if (!decrypted) {
        throw new Error('Credential not found in secure local IndexedDB database.');
      }

      const disclosedList = [];
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

      setLoadingText('Submitting grant_access transaction...');
      const expiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour
      const xdrString = await buildTransaction(
        publicKey,
        ACCESS_ID,
        'grant_access',
        [
          { value: publicKey, type: 'address' },
          nativeToScVal(request.id, { type: 'u64' }),
          nativeToScVal(expiry, { type: 'u64' })
        ]
      );
      const signed = await StellarWalletsKit.signTransaction(xdrString);
      await submitTransaction(signed.signedTxXdr);
      alert('Access granted and selective disclosure payload securely prepared!');
      await updateData();
    } catch (err: any) {
      console.error(err);
      alert(`Grant failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Verifier: Verify
  const verifyRequest = async (request: any, tampered: boolean = false) => {
    if (!publicKey) return;
    try {
      setLoading(true);
      setLoadingText('Loading selective disclosure payload...');
      
      const savedDisclosures = localStorage.getItem(`disclosures_${request.id}`);
      if (!savedDisclosures) {
        throw new Error('Disclosed data not found. Has the subject approved the request?');
      }
      
      let disclosed = JSON.parse(savedDisclosures);
      if (tampered) {
        disclosed = disclosed.map((d: any) => ({
          ...d,
          salt: '0000000000000000000000000000000000000000000000000000000000000000'
        }));
      }

      const disclosedParams = disclosed.map((d: any) => ({
        name: d.name,
        value: Buffer.from(d.value, 'hex'),
        salt: Buffer.from(d.salt, 'hex'),
        proof: d.proof.map((p: string) => Buffer.from(p, 'hex'))
      }));

      setLoadingText('Invoking verify_disclosure on-chain...');
      const isValid = await invokeReadOnly(ACCESS_ID, 'verify_disclosure', [
        nativeToScVal(request.id, { type: 'u64' }),
        nativeToScVal(disclosedParams)
      ]);

      setVerifiedResult({
        show: true,
        valid: isValid,
        txHash: 'On-chain verification complete'
      });
    } catch (err: any) {
      console.error(err);
      alert(`Verification failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#FDFBF7] py-12 px-6 flex flex-col items-center">
      <div className="w-full max-w-5xl border-4 border-[#1E293B] bg-[#FFFDF9] p-8 md:p-12 shadow-2xl relative">
        <div className="absolute top-4 right-4 md:top-8 md:right-8 w-16 h-16 rounded-full border-4 border-[#851C1C] flex items-center justify-center font-serif text-[#851C1C] text-xs font-bold rotate-12 opacity-80">
          VOUCHSAFE
        </div>

        <header className="border-b-2 border-[#1E293B] pb-6 mb-8 flex flex-col md:flex-row justify-between items-start md:items-end">
          <div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-[#1E293B] font-serif">
              VOUCHSAFE
            </h1>
            <p className="text-sm font-sans tracking-wide text-[#64748B] mt-2 uppercase font-semibold">
              Self-Sovereign Identity Attestation Vault
            </p>
          </div>

          <div className="mt-4 md:mt-0 flex flex-col items-end">
            {!publicKey ? (
              <button
                onClick={connectWallet}
                className="bg-[#851C1C] hover:bg-[#991B1B] text-[#FFFDF9] font-serif font-semibold px-6 py-2 border-2 border-[#851C1C] transition duration-200 shadow-md"
              >
                Connect Wallet
              </button>
            ) : (
              <div className="flex flex-col items-end">
                <span className="text-xs font-semibold text-[#64748B]">WALLET</span>
                <span className="text-sm font-mono font-bold text-[#1E293B]">
                  {publicKey.slice(0, 6)}...{publicKey.slice(-6)}
                </span>
                <span className="text-xs font-bold text-[#C59B27] mt-1">{balance} XLM</span>
                <button
                  onClick={disconnectWallet}
                  className="text-xs font-serif font-bold text-[#851C1C] underline mt-1 hover:text-red-700"
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Live Disclosure Activity Ticker (Centerpiece Hero Element) */}
        <section className="mb-10 bg-[#FAF7F2] border-2 border-[#C59B27] p-6 shadow-md relative overflow-hidden">
          <div className="absolute top-0 right-0 h-full w-3 bg-[#C59B27]"></div>
          <div className="flex items-center space-x-3 mb-4">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
            </span>
            <h2 className="text-lg font-serif font-black uppercase text-[#1E293B] tracking-wider">
              Live Disclosure Ticker
            </h2>
          </div>
          <div className="max-h-36 overflow-y-auto space-y-3 font-mono text-xs text-[#64748B]">
            {activityFeed.length === 0 ? (
              <div className="italic text-gray-400">Waiting for on-chain selective disclosures...</div>
            ) : (
              activityFeed.map((event, idx) => (
                <div
                  key={event.id + idx}
                  className="border-b border-[#E2E8F0] pb-2 flex justify-between items-start animate-fade-in"
                >
                  <div>
                    <span className="text-green-700 font-bold">🟢 DISCLOSURE:</span>{' '}
                    Verifier <span className="text-gray-900 font-semibold">{event.verifier.slice(0, 8)}...{event.verifier.slice(-8)}</span> verified field{' '}
                    <span className="text-[#851C1C] font-bold">"{event.field}"</span> on Request{' '}
                    <span className="font-bold text-gray-900">#{event.requestId}</span>
                  </div>
                  <div className="text-gray-400 text-[10px] pl-4">{event.timestamp}</div>
                </div>
              ))
            )}
          </div>
        </section>

        <div className="flex space-x-4 border-b border-[#E2E8F0] mb-8">
          <button
            onClick={() => setActiveTab('subject')}
            className={`pb-3 font-serif font-bold text-lg border-b-2 transition ${
              activeTab === 'subject'
                ? 'border-[#851C1C] text-[#851C1C]'
                : 'border-transparent text-[#64748B] hover:text-[#1E293B]'
            }`}
          >
            Subject Portal
          </button>
          <button
            onClick={() => setActiveTab('verifier')}
            className={`pb-3 font-serif font-bold text-lg border-b-2 transition ${
              activeTab === 'verifier'
                ? 'border-[#851C1C] text-[#851C1C]'
                : 'border-transparent text-[#64748B] hover:text-[#1E293B]'
            }`}
          >
            Verifier Portal
          </button>
        </div>

        {activeTab === 'subject' ? (
          <div>
            <section className="mb-12">
              <h2 className="text-2xl font-bold text-[#1E293B] mb-6 font-serif border-b border-[#E2E8F0] pb-2">
                Stored Credentials
              </h2>
              {credentials.length === 0 ? (
                <div className="border border-dashed border-[#64748B] rounded-lg p-8 text-center text-[#64748B]">
                  No credentials registered. Complete the issuance demo below to issue your first credential!
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {credentials.map((cred) => (
                    <div
                      key={cred.id}
                      className="border border-[#1E293B] p-6 bg-[#FFFDFB] shadow-sm relative overflow-hidden"
                    >
                      <div className="absolute top-0 right-0 px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#FFFDF9] bg-[#C59B27]">
                        ID: {cred.id}
                      </div>
                      <h3 className="font-serif font-bold text-xl text-[#1E293B] mt-2 capitalize">
                        Passport Credential
                      </h3>
                      <div className="mt-4 space-y-2 text-sm text-[#64748B]">
                        <div>
                          <span className="font-bold text-[#1E293B]">Registry Attestation:</span>{' '}
                          {cred.attestationId}
                        </div>
                        <div>
                          <span className="font-bold text-[#1E293B]">IPFS/IndexedDB ID Reference:</span> {cred.pointer}
                        </div>
                        <div>
                          <span className="font-bold text-[#1E293B]">Fields:</span>{' '}
                          {cred.fieldNames.join(', ')}
                        </div>
                        <div className="flex items-center space-x-2 mt-4">
                          <span className="font-bold text-[#1E293B]">Status:</span>
                          <span
                            className={`px-2 py-0.5 text-xs font-bold rounded-full ${
                              cred.isValid
                                ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {cred.isValid ? 'Valid / Active' : 'Invalid / Revoked'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="mb-12 border border-[#E2E8F0] p-6 bg-[#FAF9F5]">
              <h2 className="text-2xl font-bold text-[#1E293B] mb-6 font-serif">
                Issue Encrypted Passport Credential
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div>
                  <label className="block text-xs font-bold text-[#1E293B] uppercase mb-2">
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full border border-[#64748B] bg-white p-2.5 text-[#1E293B] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#1E293B] uppercase mb-2">
                    Date of Birth
                  </label>
                  <input
                    type="text"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                    className="w-full border border-[#64748B] bg-white p-2.5 text-[#1E293B] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#1E293B] uppercase mb-2">
                    License Class
                  </label>
                  <input
                    type="text"
                    value={licenseClass}
                    onChange={(e) => setLicenseClass(e.target.value)}
                    className="w-full border border-[#64748B] bg-white p-2.5 text-[#1E293B] focus:outline-none"
                  />
                </div>
              </div>
              <button
                onClick={issueCredentialFlow}
                disabled={!publicKey || !encryptionKey}
                className="bg-[#1E293B] hover:bg-[#0F172A] disabled:bg-gray-400 text-white font-serif font-bold px-8 py-3 border-2 border-[#1E293B] transition shadow-md"
              >
                Issue, Encrypt & Store
              </button>
              {(!publicKey || !encryptionKey) && (
                <p className="text-xs text-[#851C1C] mt-2 font-semibold">
                  * Connect wallet to derive key and mint credential.
                </p>
              )}
            </section>

            <section className="mb-12">
              <h2 className="text-2xl font-bold text-[#1E293B] mb-6 font-serif border-b border-[#E2E8F0] pb-2">
                Pending Access Requests
              </h2>
              {pendingRequests.length === 0 ? (
                <div className="border border-dashed border-[#64748B] rounded-lg p-8 text-center text-[#64748B]">
                  No pending access requests.
                </div>
              ) : (
                <div className="space-y-6">
                  {pendingRequests.map((req) => (
                    <div
                      key={req.id}
                      className="border border-[#1E293B] p-6 bg-[#FFFDFB] shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center"
                    >
                      <div>
                        <div className="text-xs font-bold text-[#C59B27] uppercase">
                          Request ID: {req.id}
                        </div>
                        <div className="font-serif font-bold text-lg text-[#1E293B] mt-1">
                          Verifier: {req.verifier.slice(0, 8)}...{req.verifier.slice(-8)}
                        </div>
                        <div className="text-sm text-[#64748B] mt-2">
                          Requested fields: {req.requestedFields.join(', ')}
                        </div>
                        <div className="text-xs font-bold text-[#851C1C] mt-2 uppercase">
                          Status: {req.status}
                        </div>
                      </div>

                      {req.status === 'pending' && (
                        <div className="mt-4 md:mt-0">
                          <button
                            onClick={() => grantAccess(req)}
                            className="bg-[#851C1C] hover:bg-[#991B1B] text-white font-serif font-bold px-6 py-2.5 transition shadow-sm border border-[#851C1C]"
                          >
                            Approve & Disclose
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : (
          <div>
            <section className="mb-12 border border-[#E2E8F0] p-6 bg-[#FAF9F5]">
              <h2 className="text-2xl font-bold text-[#1E293B] mb-6 font-serif">
                Initiate New Verification Request
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div>
                  <label className="block text-xs font-bold text-[#1E293B] uppercase mb-2">
                    Subject Address
                  </label>
                  <input
                    type="text"
                    value={subjectAddress}
                    onChange={(e) => setSubjectAddress(e.target.value)}
                    placeholder="G..."
                    className="w-full border border-[#64748B] bg-white p-2.5 text-[#1E293B] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#1E293B] uppercase mb-2">
                    Credential ID
                  </label>
                  <input
                    type="text"
                    value={requestCredId}
                    onChange={(e) => setRequestCredId(e.target.value)}
                    className="w-full border border-[#64748B] bg-white p-2.5 text-[#1E293B] focus:outline-none"
                  />
                </div>
              </div>

              <div className="mb-6">
                <label className="block text-xs font-bold text-[#1E293B] uppercase mb-2">
                  Select Requested Fields
                </label>
                <div className="flex space-x-6">
                  <label className="flex items-center space-x-2 text-sm text-[#1E293B] font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={reqFullName}
                      onChange={(e) => setReqFullName(e.target.checked)}
                      className="accent-[#851C1C]"
                    />
                    <span>Full Name</span>
                  </label>
                  <label className="flex items-center space-x-2 text-sm text-[#1E293B] font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={reqDob}
                      onChange={(e) => setReqDob(e.target.checked)}
                      className="accent-[#851C1C]"
                    />
                    <span>Date of Birth</span>
                  </label>
                  <label className="flex items-center space-x-2 text-sm text-[#1E293B] font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={reqLicenseClass}
                      onChange={(e) => setReqLicenseClass(e.target.checked)}
                      className="accent-[#851C1C]"
                    />
                    <span>License Class</span>
                  </label>
                </div>
              </div>

              <button
                onClick={createAccessRequest}
                disabled={!publicKey}
                className="bg-[#1E293B] hover:bg-[#0F172A] disabled:bg-gray-400 text-white font-serif font-bold px-8 py-3 border-2 border-[#1E293B] transition shadow-md"
              >
                Submit Request
              </button>
            </section>

            <section className="mb-12">
              <h2 className="text-2xl font-bold text-[#1E293B] mb-6 font-serif border-b border-[#E2E8F0] pb-2">
                Submitted Verification Requests
              </h2>
              {sentRequests.length === 0 ? (
                <div className="border border-dashed border-[#64748B] rounded-lg p-8 text-center text-[#64748B]">
                  No verification requests initiated by this wallet.
                </div>
              ) : (
                <div className="space-y-6">
                  {sentRequests.map((req) => (
                    <div
                      key={req.id}
                      className="border border-[#1E293B] p-6 bg-[#FFFDFB] shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center"
                    >
                      <div>
                        <div className="text-xs font-bold text-[#C59B27] uppercase">
                          Request ID: {req.id}
                        </div>
                        <div className="font-serif font-bold text-lg text-[#1E293B] mt-1">
                          Subject: {req.subject.slice(0, 8)}...{req.subject.slice(-8)}
                        </div>
                        <div className="text-sm text-[#64748B] mt-2">
                          Requested fields: {req.requestedFields.join(', ')}
                        </div>
                        <div className="text-xs font-bold text-[#851C1C] mt-2 uppercase">
                          Status: {req.status}
                        </div>
                      </div>

                      {req.status === 'granted' && (
                        <div className="mt-4 md:mt-0 flex space-x-3">
                          <button
                            onClick={() => verifyRequest(req, false)}
                            className="bg-[#851C1C] hover:bg-[#991B1B] text-white font-serif font-bold px-4 py-2 text-sm border border-[#851C1C] transition shadow-sm"
                          >
                            Verify Disclosures
                          </button>
                          <button
                            onClick={() => verifyRequest(req, true)}
                            className="bg-transparent hover:bg-red-50 text-[#851C1C] font-serif font-bold px-4 py-2 text-sm border border-[#851C1C] transition"
                          >
                            Test Tampered Salt
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {verifiedResult?.show && (
              <section className="border-4 border-double border-[#851C1C] p-8 bg-[#FAF8F5] text-center max-w-md mx-auto my-8 relative">
                <div className="absolute inset-0 flex items-center justify-center opacity-5 pointer-events-none font-serif text-9xl select-none">
                  W
                </div>
                <h3 className="font-serif font-bold text-2xl text-[#851C1C] mb-4">
                  OFFICIAL VERIFICATION SEAL
                </h3>
                <div className="my-6">
                  {verifiedResult.valid ? (
                    <div className="inline-block border-4 border-green-800 text-green-800 font-serif font-black text-3xl px-8 py-3 tracking-widest uppercase rotate-3">
                      VERIFIED SUCCESS
                    </div>
                  ) : (
                    <div className="inline-block border-4 border-[#851C1C] text-[#851C1C] font-serif font-black text-3xl px-8 py-3 tracking-widest uppercase rotate-3">
                      VERIFICATION FAILED
                    </div>
                  )}
                </div>
                <p className="text-xs text-[#64748B] font-mono mt-4">
                  {verifiedResult.txHash}
                </p>
              </section>
            )}
          </div>
        )}
      </div>

      {loading && (
        <div className="fixed inset-0 bg-[#0F172A] bg-opacity-70 flex items-center justify-center z-50">
          <div className="bg-[#FDFBF7] p-8 border-4 border-[#1E293B] max-w-sm text-center shadow-2xl">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#851C1C] mx-auto mb-4"></div>
            <p className="font-serif font-bold text-lg text-[#1E293B]">
              Processing Transaction
            </p>
            <p className="text-sm text-[#64748B] mt-2 font-mono">
              {loadingText}
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
