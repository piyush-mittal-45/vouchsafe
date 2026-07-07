'use client';

import React, { useState } from 'react';
import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit';
import { useWalletKit } from '../wallet/WalletKitProvider';
import { getDecryptedCredential } from '../../core/handlers/locker';
import { invokeReadOnly, VAULT_ID } from '../../core/handlers/sentry-client';
import { nativeToScVal, Networks } from '@stellar/stellar-sdk';

interface CredentialItem {
  id: number;
  attestationId: number;
  pointer: string;
  fieldNames: string[];
  createdAt: string;
  isValid: boolean;
}

interface LockerGridProps {
  credentials: CredentialItem[];
  onRefresh: () => void;
  loadCredentials: () => Promise<void>;
}

export function LockerGrid({ credentials, onRefresh, loadCredentials }: LockerGridProps) {
  const { publicKey, encryptionKey, setLoading, setLoadingText, setErrorState } = useWalletKit();
  const [decryptedData, setDecryptedData] = useState<{ [key: number]: any }>({});
  const [showDetailId, setShowDetailId] = useState<number | null>(null);

  const decryptItem = async (itemId: number) => {
    if (!encryptionKey) return;
    try {
      setLoading(true);
      setLoadingText('Decrypting data payload from IndexedDB...');
      const decrypted = await getDecryptedCredential<any>(itemId, encryptionKey);
      if (decrypted) {
        setDecryptedData(prev => ({ ...prev, [itemId]: decrypted }));
      }
    } catch (err: any) {
      setErrorState({
        show: true,
        title: "Decryption Failed",
        message: err.message || "Failed to decrypt. Ensure your current wallet session is active.",
        type: "other"
      });
    } finally {
      setLoading(false);
    }
  };

  const deleteItem = async (itemId: number) => {
    try {
      setLoading(true);
      setLoadingText('Broadcasting delete request to vault contract...');
      
      const { buildTransaction, submitTransaction } = await import('../../core/handlers/sentry-client');
      
      const txXdr = await buildTransaction(
        publicKey,
        VAULT_ID,
        'delete_credential',
        [
          { value: publicKey, type: 'address' },
          nativeToScVal(itemId, { type: 'u64' })
        ]
      );
      
      setLoadingText('Signing and confirming transaction...');
      const signed = await StellarWalletsKit.signTransaction(txXdr, {
        networkPassphrase: Networks.TESTNET,
        address: publicKey
      });
      await submitTransaction(signed.signedTxXdr);
      
      // Also clean up local state
      setDecryptedData(prev => {
        const copy = { ...prev };
        delete copy[itemId];
        return copy;
      });
      
      await loadCredentials();
    } catch (err: any) {
      console.error(err);
      setErrorState({
        show: true,
        title: "Deletion Failed",
        message: err.message || "Failed to remove credential from contract store.",
        type: "other"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-emerald-950 pb-2">
        <h2 className="text-sm font-bold tracking-widest text-[#00ff66] cyber-text-glow">
          // SECURE VAULT LOCKER
        </h2>
        <button 
          onClick={onRefresh}
          className="text-[10px] uppercase border border-emerald-900 px-2 py-0.5 hover:bg-emerald-950 text-slate-400 hover:text-[#00ff66]"
        >
          Resync
        </button>
      </div>

      {credentials.length === 0 ? (
        <div className="cyber-border bg-slate-950/40 p-6 text-center text-xs text-slate-500">
          No records identified in your local vault locker on-chain.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {credentials.map((cred) => {
            const dec = decryptedData[cred.id];
            const isShowing = showDetailId === cred.id;

            return (
              <div 
                key={cred.id} 
                className={`cyber-border p-4 bg-slate-950/60 transition-all ${
                  cred.isValid ? 'border-emerald-950' : 'border-red-950/50'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-slate-300">
                        Record #{cred.id}
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.5 border uppercase ${
                        cred.isValid 
                          ? 'border-emerald-800 text-[#00ff66] bg-emerald-950/20' 
                          : 'border-red-950 text-red-500 bg-red-950/10'
                      }`}>
                        {cred.isValid ? 'Active / Verified' : 'Void / Expired'}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">
                      Registered: {cred.createdAt} | Vouch ID: {cred.attestationId}
                    </div>
                  </div>
                  
                  <div className="flex space-x-2">
                    <button
                      onClick={() => {
                        if (isShowing) {
                          setShowDetailId(null);
                        } else {
                          setShowDetailId(cred.id);
                          if (!dec) decryptItem(cred.id);
                        }
                      }}
                      className="text-[10px] uppercase border border-emerald-900 px-2 py-1 bg-slate-900/50 hover:bg-emerald-950/40 text-slate-300 hover:text-[#00ff66]"
                    >
                      {isShowing ? 'Hide' : 'Reveal'}
                    </button>
                    <button
                      onClick={() => deleteItem(cred.id)}
                      className="text-[10px] uppercase border border-red-950 px-2 py-1 bg-slate-900/50 hover:bg-red-950/20 text-slate-400 hover:text-red-400"
                    >
                      Purge
                    </button>
                  </div>
                </div>

                {isShowing && (
                  <div className="mt-4 border-t border-slate-900 pt-3 text-[11px] font-mono space-y-2">
                    <div>
                      <span className="text-slate-500">Metadata Pointer:</span>{' '}
                      <span className="text-slate-400 break-all">{cred.pointer}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Attributes Schema:</span>{' '}
                      <span className="text-slate-400">
                        [{cred.fieldNames.join(', ')}]
                      </span>
                    </div>
                    
                    {dec ? (
                      <div className="mt-2 p-2 bg-[#090b0e] border border-slate-900 space-y-1">
                        <div className="text-[#00ff66] text-[10px] tracking-wider mb-1">
                          // DECRYPTED LOCAL PAYLOAD
                        </div>
                        <div>
                          <span className="text-slate-500">Full Name:</span>{' '}
                          <span className="text-emerald-400">{dec.fullName}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Date of Birth:</span>{' '}
                          <span className="text-slate-300">{dec.dob}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Lic. Class:</span>{' '}
                          <span className="text-slate-300">{dec.licenseClass}</span>
                        </div>
                        <div className="mt-2 text-[9px] text-slate-600 space-y-0.5">
                          <div><span className="text-slate-700">Root Hash:</span> {dec.root}</div>
                          <div><span className="text-slate-700">Salt [Name]:</span> {dec.salt0}</div>
                          <div><span className="text-slate-700">Salt [DoB]:</span> {dec.salt1}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-[10px] text-yellow-600 animate-pulse mt-2">
                        Acquiring decryption key signature...
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
