'use client';

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { StellarWalletsKit, Networks } from '@creit.tech/stellar-wallets-kit';
import { FreighterModule } from '@creit.tech/stellar-wallets-kit/modules/freighter';
import { getXlmBalance } from '../../core/handlers/sentry-client';
import { deriveKeyFromSignature } from '../../core/handlers/locker';

interface WalletContextType {
  publicKey: string;
  balance: string;
  encryptionKey: CryptoKey | null;
  setEncryptionKey: (key: CryptoKey | null) => void;
  loading: boolean;
  setLoading: (l: boolean) => void;
  loadingText: string;
  setLoadingText: (t: string) => void;
  walletDetected: boolean | null;
  errorState: {
    show: boolean;
    title: string;
    message: string;
    type: 'wallet_missing' | 'rejected' | 'insufficient_fee' | 'other';
  } | null;
  setErrorState: (state: any) => void;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
  updateBalance: () => Promise<void>;
  triggerDecryptionDerivation: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletKitProvider({ children }: { children: React.ReactNode }) {
  const [publicKey, setPublicKey] = useState<string>('');
  const [balance, setBalance] = useState<string>('0.0');
  const [encryptionKey, setEncryptionKey] = useState<CryptoKey | null>(null);
  
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingText, setLoadingText] = useState<string>('');
  const [walletDetected, setWalletDetected] = useState<boolean | null>(null);
  
  const [errorState, setErrorState] = useState<any>(null);
  
  const freighterRef = useRef<FreighterModule | null>(null);

  useEffect(() => {
    const freighter = new FreighterModule();
    freighterRef.current = freighter;
    
    StellarWalletsKit.init({
      modules: [freighter],
      network: Networks.TESTNET
    });
    
    freighter.isAvailable()
      .then(setWalletDetected)
      .catch(() => setWalletDetected(false));
  }, []);

  const updateBalance = async () => {
    if (!publicKey) return;
    try {
      const bal = await getXlmBalance(publicKey);
      setBalance(bal);
    } catch (err) {
      console.error('Failed to update balance:', err);
    }
  };

  const handleException = (err: unknown) => {
    console.error("Wallet Context Exception:", err);
    const isWalletInstalled = walletDetected !== false;
    const errObj = err as { message?: string; code?: number } | null | undefined;
    const errMsg = errObj?.message || JSON.stringify(err) || "";
    
    const isRejected = errMsg.toLowerCase().includes('cancel') ||
                       errMsg.toLowerCase().includes('reject') ||
                       errMsg.toLowerCase().includes('user close') ||
                       errObj?.code === -1;

    const xlm = parseFloat(balance);
    const isInsufficient = xlm < 2.0;

    if (!isWalletInstalled) {
      setErrorState({
        show: true,
        title: "Freighter Wallet Missing",
        message: "No compatible wallet found. Please install the Freighter browser extension to manage secure credentials.",
        type: "wallet_missing"
      });
    } else if (isInsufficient && publicKey) {
      setErrorState({
        show: true,
        title: "Insufficient XLM Balance",
        message: `Your balance is ${balance} XLM. A minimum of 2.0 XLM is required on Testnet to execute smart contracts. Please fund your address: G...${publicKey.slice(-6)}`,
        type: "insufficient_fee"
      });
    } else if (isRejected) {
      setErrorState({
        show: true,
        title: "Signature Request Rejected",
        message: "The signature challenge was declined. The operation has been aborted safely.",
        type: "rejected"
      });
    } else {
      setErrorState({
        show: true,
        title: "Blockchain RPC Error",
        message: errMsg || "The testnet node failed to respond. Please try again shortly.",
        type: "other"
      });
    }
  };

  const triggerDecryptionDerivation = async () => {
    if (!publicKey) return;
    try {
      setLoading(true);
      setLoadingText('Step 1/2: Generating Freighter signature for local key derivation...');
      
      const challenge = 'Authorize VouchSafe local encrypted database access.';
      const signRes = await StellarWalletsKit.signMessage(challenge, {
        networkPassphrase: Networks.TESTNET,
        address: publicKey
      });
      
      if (!signRes || !signRes.signedMessage) {
        throw new Error('Wallet signature is required to open the locker.');
      }
      
      setLoadingText('Step 2/2: Deriving AES key and opening secure locker...');
      const derivedKey = await deriveKeyFromSignature(signRes.signedMessage);
      setEncryptionKey(derivedKey);
    } catch (err) {
      handleException(err);
      disconnectWallet();
    } finally {
      setLoading(false);
    }
  };

  const connectWallet = async () => {
    const available = freighterRef.current
      ? await freighterRef.current.isAvailable().catch(() => false)
      : false;
    setWalletDetected(available);
    
    if (!available) {
      setErrorState({
        show: true,
        title: "Freighter Wallet Missing",
        message: "No compatible wallet found. Please install the Freighter browser extension to securely manage credentials.",
        type: "wallet_missing"
      });
      return;
    }

    try {
      setLoading(true);
      setLoadingText('Establishing connection to Freighter...');
      const { address } = await StellarWalletsKit.authModal();

      const { networkPassphrase } = await StellarWalletsKit.getNetwork();
      if (networkPassphrase !== Networks.TESTNET) {
        await StellarWalletsKit.disconnect().catch(() => {});
        setErrorState({
          show: true,
          title: "Wrong Network Detected",
          message: "VouchSafe is deployed on Stellar Testnet. Please switch Freighter to Test Net and connect again.",
          type: "other"
        });
        return;
      }

      setPublicKey(address);
    } catch (err) {
      handleException(err);
    } finally {
      setLoading(false);
    }
  };

  const disconnectWallet = async () => {
    try {
      await StellarWalletsKit.disconnect();
    } catch {}
    setPublicKey('');
    setBalance('0.0');
    setEncryptionKey(null);
  };

  // Re-fetch balance when public key is set
  useEffect(() => {
    if (publicKey) {
      updateBalance();
    }
  }, [publicKey]);

  return (
    <WalletContext.Provider value={{
      publicKey,
      balance,
      encryptionKey,
      setEncryptionKey,
      loading,
      setLoading,
      loadingText,
      setLoadingText,
      walletDetected,
      errorState,
      setErrorState,
      connectWallet,
      disconnectWallet,
      updateBalance,
      triggerDecryptionDerivation
    }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWalletKit() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWalletKit must be used within a WalletKitProvider');
  }
  return context;
}
