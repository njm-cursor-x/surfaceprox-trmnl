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

const MAX_REDIRECTS = 5;

function assertAllowed(url: URL, allowed: readonly string[]): void {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new HostNotAllowedError(url.protocol);
  }
  if (!isHostAllowed(url.hostname, allowed)) throw new HostNotAllowedError(url.hostname);
}

/**
 * Wraps `fetch` so a connector can only reach the hosts its manifest declares.
 * Redirects are followed here, one hop at a time, so an allowed host can't bounce
 * the request to a host (or LAN address) outside the list.
 */
export function createScopedFetch(allowed: readonly string[], base: FetchLike = fetch): FetchLike {
  return async (input, init) => {
    let url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    assertAllowed(url, allowed);
    if (init?.redirect === "error" || init?.redirect === "manual") return base(input, init);
    let res = await base(input, { ...init, redirect: "manual" });
    for (let hops = 0; res.status >= 300 && res.status < 400; hops++) {
      const location = res.headers.get("location");
      if (!location) return res;
      if (hops >= MAX_REDIRECTS) throw new TypeError(`Too many redirects fetching ${url.href}`);
      url = new URL(location, url);
      assertAllowed(url, allowed);
      const keepBody = res.status === 307 || res.status === 308;
      const method = keepBody ? init?.method : undefined;
      res = await base(url, {
        ...init,
        headers: init?.headers ?? (input instanceof Request ? input.headers : undefined),
        method,
        body: keepBody ? init?.body : undefined,
        redirect: "manual",
      });
    }
    return res;
  };
}
