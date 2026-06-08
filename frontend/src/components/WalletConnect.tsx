'use client';

import { ConnectButton, useCurrentAccount } from '@mysten/dapp-kit';

export function WalletConnect() {
  const account = useCurrentAccount();

  return (
    <div className="flex items-center gap-3">
      {account && (
        <span className="text-xs text-gray-400 font-mono">
          {account.address.slice(0, 6)}...{account.address.slice(-4)}
        </span>
      )}
      <ConnectButton
        connectText="Connect Wallet"
        className="!bg-indigo-600 !text-white !rounded-lg !px-4 !py-2 !text-sm !font-medium hover:!bg-indigo-500 !transition-colors"
      />
    </div>
  );
}
