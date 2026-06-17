"use client";

import {
  ConnectModal,
  useCurrentAccount,
  useDisconnectWallet,
} from "@mysten/dapp-kit";
import { Button } from "./ui/button";

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

const Nav = () => {
  const account = useCurrentAccount();
  const { mutate: disconnect } = useDisconnectWallet();

  return (
    <div className="w-full flex items-center justify-between">
      <p className="text-xl font-semibold">Sweem</p>
      {account ? (
        <Button variant="outline" onClick={() => disconnect()}>
          {shortAddr(account.address)}
        </Button>
      ) : (
        <ConnectModal trigger={<Button>Connect</Button>} />
      )}
    </div>
  );
};

export default Nav;
