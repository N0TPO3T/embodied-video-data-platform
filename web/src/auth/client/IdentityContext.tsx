"use client";

import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";

import type { AccountPublic, TeamPublic } from "../contracts";

type IdentityValue = {
  currentAccount: AccountPublic;
  accounts: AccountPublic[];
  teams: TeamPublic[];
  upsertAccount(account: AccountPublic): void;
  removeAccount(id: string): void;
  upsertTeam(team: TeamPublic): void;
};

const IdentityContext = createContext<IdentityValue | null>(null);

function upsert<T extends { id: string }>(items: T[], next: T): T[] {
  const exists = items.some((item) => item.id === next.id);
  return exists
    ? items.map((item) => (item.id === next.id ? next : item))
    : [...items, next];
}

export function IdentityProvider({
  children,
  currentAccount: initialCurrentAccount,
  accounts: initialAccounts,
  teams: initialTeams,
}: {
  children: ReactNode;
  currentAccount: AccountPublic;
  accounts: AccountPublic[];
  teams: TeamPublic[];
}) {
  const [currentAccount, setCurrentAccount] = useState(initialCurrentAccount);
  const [accounts, setAccounts] = useState(initialAccounts);
  const [teams, setTeams] = useState(initialTeams);

  function upsertAccount(account: AccountPublic) {
    setAccounts((items) => upsert(items, account));
    setCurrentAccount((current) =>
      current.id === account.id ? account : current,
    );
  }

  return (
    <IdentityContext.Provider
      value={{
        currentAccount,
        accounts,
        teams,
        upsertAccount,
        removeAccount: (id) =>
          setAccounts((items) => items.filter((item) => item.id !== id)),
        upsertTeam: (team) => setTeams((items) => upsert(items, team)),
      }}
    >
      {children}
    </IdentityContext.Provider>
  );
}

export function useIdentity(): IdentityValue {
  const value = useContext(IdentityContext);
  if (!value) {
    throw new Error("useIdentity must be used inside IdentityProvider");
  }
  return value;
}
