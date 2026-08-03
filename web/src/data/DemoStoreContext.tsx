"use client";

import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Role, WithdrawalStatus } from "../domain/types";
import { createDemoStore, demoSeed, type DemoStore } from "./demoStore";

type DemoStoreValue = {
  state: ReturnType<DemoStore["getState"]>;
  currentUser: ReturnType<DemoStore["getState"]>["users"][number];
  currentTeam?: ReturnType<DemoStore["getState"]>["teams"][number];
  loginAs(role: Role): void;
  addUploads(files: File[]): void;
  adjustQuality(id: string, score: number, reason: string): void;
  requestWithdrawal(amount: number): void;
  reviewWithdrawal(id: string, status: WithdrawalStatus): void;
};

const DemoStoreContext = createContext<DemoStoreValue | null>(null);

export function DemoStoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createDemoStore(demoSeed));
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
        loginAs: (role) => store.loginAs(role),
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
