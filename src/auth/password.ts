import argon2 from "argon2";

// argon2id: the OWASP-recommended default over bcrypt for new systems
// (resistant to GPU/ASIC cracking via memory-hardness); argon2's native
// bindings also sidestep the bcrypt-vs-passlib self-test incompatibility
// hit on other repos in this portfolio (see tenant-vault notes).
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain);
}
