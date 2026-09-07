import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { WalletFailure } from "./wallet.failure.js";

export type PayoutRecipient = { method: "alipay" | "bank"; account: string; name: string; bankName: string };
export type WithdrawalInput = { amount: number; idempotencyKey: string; method: "alipay" | "bank"; account: string; name: string; bankName?: string };

export function payoutKey(): Buffer {
  const value = process.env.PAYOUT_RECIPIENT_KEY;
  if (!value || !/^[a-fA-F0-9]{64}$/u.test(value)) {
    throw new WalletFailure("PAYOUT_UNAVAILABLE", "提现密钥未配置，暂不可提交或导出", 503);
  }
  return Buffer.from(value, "hex");
}
export function requiredText(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new WalletFailure("VALIDATION", "请检查必填信息与长度（不允许控制字符）", 400);
  }
  return value.trim();
}
export function normalizeWithdrawal(input: WithdrawalInput) {
  const cents = Math.round(input.amount * 100);
  if (!Number.isFinite(input.amount) || cents < 1 || cents > 1_000_000_000 || Math.abs(input.amount * 100 - cents) > 0.000001) {
    throw new WalletFailure("VALIDATION", "金额须为 0.01 至 10000000 元且最多两位小数", 400);
  }
  if (input.method !== "alipay" && input.method !== "bank") throw new WalletFailure("VALIDATION", "不支持的收款方式", 400);
  const recipient: PayoutRecipient = {
    method: input.method, account: requiredText(input.account, 200), name: requiredText(input.name, 120),
    bankName: input.method === "bank" ? requiredText(input.bankName, 120) : "",
  };
  const idempotencyKey = requiredText(input.idempotencyKey, 64);
  return { cents, recipient, idempotencyKey };
}
export function encryptRecipient(recipient: PayoutRecipient, requestId: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(requestId));
  const data = Buffer.concat([cipher.update(JSON.stringify(recipient), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}
export function decryptRecipient(value: string, requestId: string, key: Buffer): PayoutRecipient {
  try {
    const [version, iv, tag, data] = value.split(":");
    if (version !== "v1" || !iv || !tag || !data) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAAD(Buffer.from(requestId));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8")) as PayoutRecipient;
  } catch {
    throw new WalletFailure("PAYOUT_UNAVAILABLE", "收款信息无法解密，请联系密钥管理员", 503);
  }
}
export function payoutHash(cents: number, recipient: PayoutRecipient, key: Buffer): string {
  return createHmac("sha256", key).update(JSON.stringify({ cents, recipient })).digest("hex");
}
export function moneyCents(value: string): number {
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export function centsMoney(value: number): string { return `${Math.trunc(value / 100)}.${String(value % 100).padStart(2, "0")}`; }
