export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class HostNotAllowedError extends Error {
  constructor(public readonly host: string) {
    super(`Host "${host}" is not in this connector's allowed hosts`);
    this.name = "HostNotAllowedError";
  }
}

/** `"*.example.com"` matches subdomains only; a bare host matches exactly. */
export function isHostAllowed(host: string, allowed: readonly string[]): boolean {
  const h = host.toLowerCase();
  return allowed.some((pattern) => {
    const p = pattern.toLowerCase();
    if (p.startsWith("*.")) return h.endsWith(p.slice(1));
    return h === p;
  });
}

/** Wraps `fetch` so a connector can only reach the hosts its manifest declares. */
export function createScopedFetch(allowed: readonly string[], base: FetchLike = fetch): FetchLike {
  return (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return Promise.reject(new HostNotAllowedError(url.protocol));
    }
    if (!isHostAllowed(url.hostname, allowed)) {
      return Promise.reject(new HostNotAllowedError(url.hostname));
    }
    return base(input, init);
  };
}
