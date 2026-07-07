'use client';

import React, { useEffect, useState } from 'react';
import { WalletKitProvider, useWalletKit } from '../wallet/WalletKitProvider';
import { LockerGrid } from './LockerGrid';
import { GateConsole } from './GateConsole';
import { invokeReadOnly, VAULT_ID, REGISTRY_ID } from '../../core/handlers/sentry-client';
import { nativeToScVal } from '@stellar/stellar-sdk';

interface CredentialItem {
  id: number;
  attestationId: number;
  pointer: string;
  fieldNames: string[];
  createdAt: string;
  isValid: boolean;
}

function DashboardContent() {
  const {
    publicKey,
    balance,
    encryptionKey,
    loading,
    loadingText,
    errorState,
    setErrorState,
    connectWallet,
    disconnectWallet,
    triggerDecryptionDerivation
  } = useWalletKit();

  const [credentials, setCredentials] = useState<CredentialItem[]>([]);

  // Load user credentials
  const loadCredentials = async () => {
    if (!publicKey) return;
    try {
      const ids = await invokeReadOnly<Array<number | bigint>>(VAULT_ID, 'query_owner_vault', [
        { value: publicKey, type: 'address' }
      ]);

      if (!ids || ids.length === 0) {
        setCredentials([]);
        return;
      }

      const list: CredentialItem[] = [];
      for (const idVal of ids) {
        const id = Number(idVal);
        const meta = await invokeReadOnly<{
          vouch_id: number | bigint;
          storage_reference: string;
          attributes: string[];
          stored_timestamp: number | bigint;
        }>(VAULT_ID, 'fetch_credential_details', [
          nativeToScVal(id, { type: 'u64' })
        ]);
        if (!meta) continue;

        const isValid = await invokeReadOnly<boolean>(REGISTRY_ID, 'check_vouch_validity', [
          nativeToScVal(meta.vouch_id, { type: 'u64' })
        ]);

        list.push({
          id,
          attestationId: Number(meta.vouch_id),
          pointer: meta.storage_reference,
          fieldNames: meta.attributes,
          createdAt: new Date(Number(meta.stored_timestamp) * 1000).toLocaleDateString(),
          isValid: Boolean(isValid)
        });
      }
      setCredentials(list);
    } catch (err) {
      console.error('Failed to load credentials:', err);
    }
  };

  // Trigger loading when wallet or key changes
  useEffect(() => {
    if (publicKey && encryptionKey) {
      loadCredentials();
    }
  }, [publicKey, encryptionKey]);

  // If publicKey is connected but encryptionKey is missing, prompt signature automatically
  useEffect(() => {
    if (publicKey && !encryptionKey && !loading) {
      triggerDecryptionDerivation();
    }
  }, [publicKey, encryptionKey]);

  return (
    <main className="min-h-screen bg-[#07080a] py-6 px-4 sm:py-12 sm:px-6 flex flex-col items-center cyber-grid">
      <div className="w-full max-w-5xl border border-[#00ff66]/20 bg-[#090b0e]/90 p-4 sm:p-6 md:p-8 shadow-2xl relative cyber-glow">
        
        {/* Top HUD Branding */}
        <header className="border-b border-[#00ff66]/15 pb-6 mb-8 flex flex-col md:flex-row justify-between items-start md:items-end space-y-4 md:space-y-0">
          <div>
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 bg-[#00ff66] inline-block cyber-glow"></span>
              <h1 className="text-xl sm:text-2xl font-bold tracking-widest text-[#00ff66] cyber-text-glow">
                VOUCHSAFE // SYSTEM ACTIVE
              </h1>
            </div>
            <p className="text-[10px] sm:text-xs font-mono tracking-wider text-slate-500 mt-1 uppercase font-semibold">
              Cryptographic Credentials & Verification Shield
            </p>
          </div>

          <div className="flex flex-col items-start md:items-end w-full md:w-auto">
            {!publicKey ? (
              <button
                onClick={connectWallet}
                className="w-full md:w-auto bg-emerald-950/20 hover:bg-emerald-900/40 text-[#00ff66] border border-[#00ff66]/30 px-6 py-2 transition tracking-wider text-xs uppercase font-bold"
              >
                Establish Connection
              </button>
            ) : (
              <div className="flex flex-col items-start md:items-end w-full space-y-1">
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">{"// SECURED TERMINAL"}</span>
                <span className="text-xs font-mono text-[#00ff66] break-all bg-black/40 border border-slate-900 px-2 py-0.5 max-w-xs md:max-w-md">
                  {publicKey}
                </span>
                <div className="flex items-center justify-between w-full md:w-auto md:space-x-4 mt-1">
                  <span className="text-[11px] text-emerald-400 font-bold tracking-wider">{balance} XLM</span>
                  <button
                    onClick={disconnectWallet}
                    className="text-[9px] uppercase border border-red-950 text-red-500 bg-red-950/10 px-2 py-0.5 hover:bg-red-950/30"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Workspace Body */}
        {!publicKey ? (
          <div className="border border-slate-900 bg-black/30 p-12 text-center space-y-4">
            <div className="text-slate-500 text-xs tracking-wider">
              CONNECT WALLET TO INTERACT WITH THE SECURE SYSTEM COMPONENT
            </div>
            <p className="text-[11px] text-slate-600 max-w-md mx-auto">
              Please open the Freighter extension on Stellar Test Net. Ensure you have sufficient test XLM to pay for network contract operations.
            </p>
          </div>
        ) : !encryptionKey ? (
          <div className="border border-[#00ff66]/10 bg-black/20 p-12 text-center space-y-4">
            <div className="text-yellow-600 text-xs tracking-wider uppercase animate-pulse">
              Vault Access Signature Requested
            </div>
            <p className="text-[11px] text-slate-400 max-w-md mx-auto">
              Confirm the message signature via Freighter. VouchSafe derives your local AES-GCM locker decryption key directly from this signature.
            </p>
            <button
              onClick={triggerDecryptionDerivation}
              className="text-xs uppercase border border-yellow-950 text-yellow-500 hover:text-yellow-400 px-4 py-1.5 hover:bg-yellow-950/20"
            >
              Retry Decryption Unlock
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Panel: LockerGrid */}
            <div className="lg:col-span-5 space-y-6">
              <LockerGrid 
                credentials={credentials} 
                onRefresh={loadCredentials} 
                loadCredentials={loadCredentials} 
              />
            </div>
            {/* Right Panel: Cockpit Controls */}
            <div className="lg:col-span-7 space-y-6 border-l border-slate-900 lg:pl-8">
              <GateConsole loadCredentials={loadCredentials} />
            </div>
          </div>
        )}

        {/* Footer Technical Labels */}
        <footer className="mt-12 pt-4 border-t border-slate-950 flex flex-col sm:flex-row justify-between text-[9px] text-slate-600 font-mono tracking-widest uppercase">
          <div>VouchSafe v0.1.0 // network: stellar-testnet</div>
          <div className="mt-2 sm:mt-0">authenticated cryptographically via freighter</div>
        </footer>
      </div>

      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="cyber-border bg-[#090b0e] p-6 max-w-sm w-full text-center space-y-4 shadow-2xl">
            <div className="w-8 h-8 border-2 border-t-transparent border-[#00ff66] rounded-full animate-spin mx-auto"></div>
            <div className="text-xs font-bold text-[#00ff66] tracking-wider">{"// PIPELINE OPERATION ACTIVE"}</div>
            <p className="text-[10px] text-slate-400 leading-relaxed font-mono">
              {loadingText}
            </p>
          </div>
        </div>
      )}

      {/* Exception Error Dialog */}
      {errorState && errorState.show && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="cyber-border border-red-500 bg-[#090b0e] p-6 max-w-md w-full text-center space-y-4 shadow-2xl">
            <div className="text-red-500 text-sm font-bold tracking-widest uppercase">
              ! ERROR // {errorState.title}
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed font-mono break-words">
              {errorState.message}
            </p>
            <div className="pt-2">
              <button
                onClick={() => setErrorState(null)}
                className="text-xs uppercase border border-slate-700 hover:border-slate-400 text-slate-300 hover:text-slate-100 px-6 py-1.5 font-bold"
              >
                Dismiss Warning
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function PortalDashboard() {
  return (
    <WalletKitProvider>
      <DashboardContent />
    </WalletKitProvider>
  );
}
