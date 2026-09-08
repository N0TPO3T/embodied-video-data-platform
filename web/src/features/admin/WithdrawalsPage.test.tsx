import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";
import type { WithdrawalList, WithdrawalRequest } from "../../wallet/contracts";

const api = vi.hoisted(() => ({ listWithdrawals: vi.fn(), claimWithdrawals: vi.fn(), exportWithdrawalBatch: vi.fn(), updateWithdrawal: vi.fn() }));
vi.mock("../../wallet/client/walletApi", async importOriginal => ({ ...await importOriginal<typeof import("../../wallet/client/walletApi")>(), ...api }));
let row: WithdrawalRequest;
beforeEach(() => {
  vi.clearAllMocks();
  row = { id: "WR-finance", ownerId: "U-collector", amount: 8.25, status: "pending", method: "bank", accountMasked: "***1234", nameMasked: "张***", batchId: null, reason: null, transferReference: null, paidAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  api.listWithdrawals.mockImplementation(async () => ({ requests: [{ ...row }], pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 } }));
  api.claimWithdrawals.mockImplementation(async () => { row = { ...row, batchId: "WB-finance", status: "processing" }; return { batchId: row.batchId, requests: [row] }; });
  api.updateWithdrawal.mockImplementation(async (_id: string, input: Partial<WithdrawalRequest>) => { row = { ...row, ...input }; return { request: row }; });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

it("opens the finance route and requires a distinct verified-payment action after claiming", async () => {
  const user = userEvent.setup();
  window.history.replaceState({}, "", "/admin/withdrawals");
  render(<IdentityProvider currentAccount={accountForRole("admin")} accounts={demoAccounts} teams={[]}><PlatformApp initialPath="/admin/withdrawals" /></IdentityProvider>);
  await user.click(await screen.findByLabelText("选择 WR-finance"));
  await user.click(screen.getByRole("button", { name: /领取所选并创建批次/ }));
  expect(await screen.findByRole("button", { name: "确认实际付款" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "拒绝并退回余额" })).not.toBeInTheDocument();
  expect(api.exportWithdrawalBatch).not.toHaveBeenCalled();
  expect(api.updateWithdrawal).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "确认实际付款" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("button", { name: "提交财务确认" })).toBeDisabled();
  await user.type(within(dialog).getByLabelText("转账参考号"), "BANK-verified-123");
  // A datetime-local input accepts its browser-normalized local value.
  const dateInput = within(dialog).getByLabelText("付款时间");
  fireEvent.change(dateInput, { target: { value: "2026-01-02T12:30" } });
  await user.click(within(dialog).getByRole("checkbox"));
  await user.click(within(dialog).getByRole("button", { name: "提交财务确认" }));
  expect(await screen.findByText(/BANK-verified-123/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "确认实际付款" })).not.toBeInTheDocument();
});

it("does not claim stale selections or display an obsolete filter response", async () => {
  const user = userEvent.setup();
  render(<IdentityProvider currentAccount={accountForRole("admin")} accounts={demoAccounts} teams={[]}><PlatformApp initialPath="/admin/withdrawals" /></IdentityProvider>);
  await user.click(await screen.findByLabelText("选择 WR-finance"));
  let resolveProcessing!: (value: WithdrawalList) => void;
  let resolvePaid!: (value: WithdrawalList) => void;
  api.listWithdrawals.mockImplementationOnce(() => new Promise<WithdrawalList>(resolve => { resolveProcessing = resolve; }))
    .mockImplementationOnce(() => new Promise<WithdrawalList>(resolve => { resolvePaid = resolve; }));
  await user.selectOptions(screen.getByLabelText("提现状态"), "processing");
  expect(screen.queryByLabelText("选择 WR-finance")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /领取所选并创建批次/ })).toBeDisabled();
  await user.selectOptions(screen.getByLabelText("提现状态"), "paid");
  const pagination = { page: 1, pageSize: 25, total: 1, totalPages: 1 };
  await act(async () => resolvePaid({ requests: [{ ...row, id: "WR-paid", status: "paid" }], pagination }));
  expect(await screen.findByLabelText("选择 WR-paid")).toBeDisabled();
  await act(async () => resolveProcessing({ requests: [{ ...row, id: "WR-obsolete", status: "processing" }], pagination }));
  expect(screen.queryByLabelText("选择 WR-obsolete")).not.toBeInTheDocument();
  expect(screen.getByLabelText("选择 WR-paid")).toBeInTheDocument();
  expect(api.claimWithdrawals).not.toHaveBeenCalled();
});
