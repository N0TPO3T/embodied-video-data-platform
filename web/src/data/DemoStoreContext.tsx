"use client";

import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { AccountPublic, TeamPublic } from "../auth/contracts";
import type { User, WithdrawalStatus } from "../domain/types";
import type { BackendSubmission } from "../submissions/contracts";
import { backendSubmissionToDomain } from "../submissions/submissionMapper";
import {
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
  upsertSubmission(submission: BackendSubmission): void;
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
  teams: TeamPublic[] | undefined,
  backendSubmissions?: BackendSubmission[],
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
  const seed = structuredClone(demoSeed);
  return {
    ...seed,
    currentUserId: currentAccount.id,
    users,
    teams: (teams === undefined ? demoSeed.teams : teams).map((team) => {
      const assigned = users.filter((user) => user.teamId === team.id);
      const leader = assigned.find((user) => user.role === "leader");
      return {
        id: team.id,
        name: team.name,
        leaderId: leader?.id ?? ("leaderId" in team ? team.leaderId : ""),
        memberIds: assigned
          .filter((user) => user.id !== leader?.id)
          .map((user) => user.id),
        unitPricePerMinute: team.unitPricePerMinute,
      };
    }),
    submissions:
      backendSubmissions === undefined
        ? seed.submissions
        : backendSubmissions.map(backendSubmissionToDomain),
  };
}

export function DemoStoreProvider({
  children,
  currentAccount,
  accounts,
  teams,
  backendSubmissions,
}: {
  children: ReactNode;
  currentAccount?: AccountPublic;
  accounts?: AccountPublic[];
  teams?: TeamPublic[];
  backendSubmissions?: BackendSubmission[];
}) {
  const [store] = useState(() =>
    createDemoStore(
      currentAccount
        ? authenticatedSeed(
            currentAccount,
            accounts ?? [currentAccount],
            teams,
            backendSubmissions,
          )
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
        upsertSubmission: (submission) =>
          store.upsertSubmission(backendSubmissionToDomain(submission)),
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
