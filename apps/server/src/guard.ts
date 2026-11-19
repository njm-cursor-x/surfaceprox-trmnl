import { isIP } from "node:net";
import { isHostAllowed } from "@slate/sdk";
import type { MiddlewareHandler } from "hono";

const LAN_SUFFIXES = [".localhost", ".local", ".lan", ".home.arpa", ".internal"];

function hostname(host: string): string {
  const h = host.trim().toLowerCase();
  const name = h.startsWith("[") ? h.slice(1, h.indexOf("]")) : h.replace(/:\d+$/, "");
  return name.replace(/\.$/, "");
}

/**
 * Names a remote site can't make a victim's browser resolve to this server: IP literals,
 * localhost, single-label and LAN-only suffixes, plus `SLATE_ALLOWED_HOSTS`. Rejecting
 * every other Host header is what stops DNS rebinding from reaching the unauthenticated API.
 */
export function isLanHost(host: string, extra: readonly string[] = []): boolean {
  const h = hostname(host);
  if (!h) return false;
  if (isIP(h) !== 0 || h === "localhost" || !h.includes(".")) return true;
  return LAN_SUFFIXES.some((s) => h.endsWith(s)) || isHostAllowed(h, extra);
}

export function parseAllowedHosts(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function lanGuard(allowedHosts: readonly string[]): MiddlewareHandler {
  return async (c, next) => {
    const host = c.req.header("host") ?? new URL(c.req.url).host;
    if (!isLanHost(host, allowedHosts)) {
      return c.text(`Host "${host}" is not allowed. Add it to SLATE_ALLOWED_HOSTS.`, 403);
    }
    const method = c.req.method;
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      const origin = c.req.header("origin");
      let sameOrigin = true;
      if (origin !== undefined) {
        try {
          sameOrigin = new URL(origin).host === host.toLowerCase();
        } catch {
          sameOrigin = false;
        }
      }
      if (!sameOrigin) return c.json({ ok: false, error: "Cross-origin write rejected" }, 403);
    }
    await next();
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "no-referrer");
    if (c.res.headers.get("content-type")?.startsWith("text/html") && c.req.path === "/") {
      c.header("x-frame-options", "DENY");
      c.header("content-security-policy", "frame-ancestors 'none'");
    }
  };
}
