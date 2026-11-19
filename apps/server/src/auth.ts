import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface AuthFile {
  version: 1;
  /** Signs session cookies. Rotating it (deleting auth.json) signs everyone out. */
  secret: string;
  admin?: { salt: string; hash: string; generation: number };
  setupComplete: boolean;
}

export const SESSION_COOKIE = "slate_session";
export const SESSION_MAX_AGE_S = 30 * 24 * 3600;
export const MIN_PASSWORD = 8;

const SCRYPT = { N: 16_384, r: 8, p: 1 } as const;
const hashPassword = (password: string, salt: string) =>
  scryptSync(password.normalize("NFKC"), Buffer.from(salt, "base64url"), 64, SCRYPT);

/**
 * Admin password, session signing, and first-run state, in `<data>/auth.json` (0600).
 * Until an admin exists, a one-time setup code in `<data>/setup-code` gates the claim
 * from other machines on the LAN.
 */
export class AuthStore {
  readonly file: string;
  readonly codeFile: string;
  private state: AuthFile;
  private code?: string;

  constructor(readonly dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, "auth.json");
    this.codeFile = join(dataDir, "setup-code");
    this.state = existsSync(this.file)
      ? (JSON.parse(readFileSync(this.file, "utf8")) as AuthFile)
      : { version: 1, secret: randomBytes(32).toString("base64url"), setupComplete: false };
    if (!existsSync(this.file)) this.write();
    if (!this.hasAdmin()) {
      this.code = existsSync(this.codeFile)
        ? readFileSync(this.codeFile, "utf8").trim()
        : randomBytes(6).toString("hex").toUpperCase();
      writeFileSync(this.codeFile, this.code + "\n", { mode: 0o600 });
    }
  }

  hasAdmin(): boolean {
    return Boolean(this.state.admin);
  }

  get setupComplete(): boolean {
    return this.state.setupComplete;
  }

  /** The pending setup code, or undefined once an admin exists. */
  get setupCode(): string | undefined {
    return this.hasAdmin() ? undefined : this.code;
  }

  checkSetupCode(code: unknown): boolean {
    if (!this.code || typeof code !== "string") return false;
    return safeEqual(code.trim().toUpperCase(), this.code);
  }

  createAdmin(password: string): void {
    if (this.hasAdmin()) throw new Error("An admin already exists");
    this.setPassword(password);
    this.code = undefined;
    rmSync(this.codeFile, { force: true });
  }

  setPassword(password: string): void {
    if (password.length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters`);
    const salt = randomBytes(16).toString("base64url");
    this.state.admin = {
      salt,
      hash: hashPassword(password, salt).toString("base64url"),
      generation: (this.state.admin?.generation ?? 0) + 1,
    };
    this.write();
  }

  verifyPassword(password: unknown): boolean {
    const admin = this.state.admin;
    if (!admin || typeof password !== "string") return false;
    return timingSafeEqual(
      hashPassword(password, admin.salt),
      Buffer.from(admin.hash, "base64url"),
    );
  }

  completeSetup(): void {
    this.state.setupComplete = true;
    this.write();
  }

  /** Sessions carry the password generation, so changing the password signs out old ones. */
  issueSession(now = Date.now()): string {
    const payload = Buffer.from(
      JSON.stringify({ exp: now + SESSION_MAX_AGE_S * 1000, g: this.state.admin?.generation }),
    ).toString("base64url");
    return `${payload}.${this.sign(payload)}`;
  }

  verifySession(token: string | undefined, now = Date.now()): boolean {
    if (!token || !this.state.admin) return false;
    const [payload, sig] = token.split(".");
    if (!payload || !sig || !safeEqual(sig, this.sign(payload))) return false;
    try {
      const { exp, g } = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
        exp: number;
        g: number;
      };
      return exp > now && g === this.state.admin.generation;
    } catch {
      return false;
    }
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.state.secret).update(payload).digest("base64url");
  }

  private write(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Fixed-window limit on failed logins per client address. */
export class LoginLimiter {
  private fails = new Map<string, { count: number; since: number }>();
  constructor(
    private max = 10,
    private windowMs = 10 * 60_000,
  ) {}

  blocked(key: string, now = Date.now()): boolean {
    const f = this.fails.get(key);
    if (!f || now - f.since > this.windowMs) return false;
    return f.count >= this.max;
  }

  fail(key: string, now = Date.now()): void {
    const f = this.fails.get(key);
    if (!f || now - f.since > this.windowMs) this.fails.set(key, { count: 1, since: now });
    else f.count++;
  }

  reset(key: string): void {
    this.fails.delete(key);
  }
}
