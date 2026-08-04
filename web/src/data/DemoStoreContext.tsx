"use client";

import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { AccountPublic } from "../auth/contracts";
import type { User, WithdrawalStatus } from "../domain/types";
import {
  alignAccountTeams,
  createDemoStore,
  demoSeed,
  type DeliveryPackageInput,
  type DemoStore,
  type RuleVersionInput,
  type UpdateLabelInput,
} from "./demoStore";

type DemoStoreValue = {
  state: ReturnType<DemoStore["getState"]>;
  currentUser: ReturnType<DemoStore["getState"]>["users"][number];
  currentTeam?: ReturnType<DemoStore["getState"]>["teams"][number];
  syncAccount(user: User): void;
  createRuleVersion(
    input: RuleVersionInput,
  ): ReturnType<DemoStore["createRuleVersion"]>;
  updateLabel(input: UpdateLabelInput): ReturnType<DemoStore["updateLabel"]>;
  createSettlementBatch(): ReturnType<DemoStore["createSettlementBatch"]>;
  createDeliveryPackage(
    input: DeliveryPackageInput,
  ): ReturnType<DemoStore["createDeliveryPackage"]>;
  addUploads(files: File[]): void;
  adjustQuality(id: string, score: number, reason: string): void;
  requestWithdrawal(amount: number): void;
  reviewWithdrawal(id: string, status: WithdrawalStatus): void;
};

const DemoStoreContext = createContext<DemoStoreValue | null>(null);

export function accountToUser(
  account: AccountPublic,
  existing?: User,
): User {
  return {
    id: account.id,
    name: account.displayName,
    account: account.username,
    role: account.role,
    teamId: account.teamId,
    avatar: existing?.avatar ?? account.displayName.slice(0, 1),
    phone: existing?.phone ?? "未设置",
    alipayAccount: existing?.alipayAccount,
    status: account.status,
    updatedAt: account.updatedAt,
  };
}

function authenticatedSeed(
  currentAccount: AccountPublic,
  accounts: AccountPublic[],
) {
  const snapshot = accounts.some(
    (account) => account.id === currentAccount.id,
  )
    ? accounts
    : [currentAccount, ...accounts];
  const users = snapshot.map((account) =>
    accountToUser(
      account,
      demoSeed.users.find((user) => user.id === account.id),
    ),
  );
  return {
    ...structuredClone(demoSeed),
    currentUserId: currentAccount.id,
    users,
    teams: alignAccountTeams(demoSeed.teams, users),
  };
}

export function DemoStoreProvider({
  children,
  currentAccount,
  accounts,
}: {
  children: ReactNode;
  currentAccount?: AccountPublic;
  accounts?: AccountPublic[];
}) {
  const [store] = useState(() =>
    createDemoStore(
      currentAccount
        ? authenticatedSeed(currentAccount, accounts ?? [currentAccount])
        : demoSeed,
    ),
  );
  const state = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getState(),
    () => store.getState(),
  );
  const currentUser = state.users.find(
    (item) => item.id === state.currentUserId,
  )!;
  const currentTeam = state.teams.find((item) => item.id === currentUser.teamId);

  return (
    <DemoStoreContext.Provider
      value={{
        state,
        currentUser,
        currentTeam,
        syncAccount: (user) => store.syncAccount(user),
        createRuleVersion: (input) => store.createRuleVersion(input),
        updateLabel: (input) => store.updateLabel(input),
        createSettlementBatch: () => store.createSettlementBatch(),
        createDeliveryPackage: (input) => store.createDeliveryPackage(input),
        addUploads: (files) => store.addUploads(files),
        adjustQuality: (id, score, reason) =>
          store.adjustQuality(id, score, reason),
        requestWithdrawal: (amount) => store.requestWithdrawal(amount),
        reviewWithdrawal: (id, status) =>
          store.reviewWithdrawal(id, status),
      }}
    >
      {children}
    </DemoStoreContext.Provider>
  );
}

export function useDemoStore(): DemoStoreValue {
  const value = useContext(DemoStoreContext);
  if (!value) {
    throw new Error("useDemoStore must be used inside DemoStoreProvider");
  }
  return value;
}
