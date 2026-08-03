"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Role, WithdrawalStatus } from "../domain/types";
import {
  createDemoStore,
  demoSeed,
  type AddUserInput,
  type DeliveryPackageInput,
  type DemoStore,
  type InviteMemberInput,
  type RuleVersionInput,
  type UpdateLabelInput,
  type UpdateUserInput,
} from "./demoStore";

type DemoStoreValue = {
  state: ReturnType<DemoStore["getState"]>;
  currentUser: ReturnType<DemoStore["getState"]>["users"][number];
  currentTeam?: ReturnType<DemoStore["getState"]>["teams"][number];
  loginAs(role: Role): void;
  inviteMember(input: InviteMemberInput): ReturnType<DemoStore["inviteMember"]>;
  addUser(input: AddUserInput): ReturnType<DemoStore["addUser"]>;
  updateUser(input: UpdateUserInput): ReturnType<DemoStore["updateUser"]>;
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

export function DemoStoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createDemoStore(demoSeed));
  const loginAs = useCallback((role: Role) => store.loginAs(role), [store]);
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
        loginAs,
        inviteMember: (input) => store.inviteMember(input),
        addUser: (input) => store.addUser(input),
        updateUser: (input) => store.updateUser(input),
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
