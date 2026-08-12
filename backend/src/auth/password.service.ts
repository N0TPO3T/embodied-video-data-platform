import { Injectable } from "@nestjs/common";
import * as argon2 from "argon2";

@Injectable()
export class PasswordService {
  private readonly dummyHash = argon2.hash(
    "not-a-real-account-password",
    { type: argon2.argon2id },
  );

  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  verify(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }

  async verifyUnknown(password: string): Promise<void> {
    await this.verify(await this.dummyHash, password);
  }
}
