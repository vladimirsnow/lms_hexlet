import { hash, verify } from "@node-rs/argon2";

const ARGON2ID_ALGORITHM = 2 as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, {
    algorithm: ARGON2ID_ALGORITHM,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
  });
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}
