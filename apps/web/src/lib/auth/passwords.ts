import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

// scrypt (node:crypto, no new dependency) rather than a third-party hashing library — it's a
// NIST-recommended KDF, built into Node, and avoids adding a native-binding dependency
// (bcrypt/argon2) to a monorepo that already has enough moving parts. Good enough for a
// development-only credential store; a production auth provider is a separate concern
// entirely (see docs/AUTHENTICATION.md and section 9 of the plan behind this migration).
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, saltHex, keyHex] = parts;
  const salt = Buffer.from(saltHex, "hex");
  const expectedKey = Buffer.from(keyHex, "hex");
  const derivedKey = (await scrypt(password, salt, expectedKey.length)) as Buffer;
  // Constant-time compare — a plain === on the hex strings would leak timing information
  // about how many leading bytes matched.
  return derivedKey.length === expectedKey.length && timingSafeEqual(derivedKey, expectedKey);
}
