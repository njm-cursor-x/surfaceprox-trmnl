import type { z } from "zod";
import type { Connector } from "./connector.ts";
import { createScopedFetch, type FetchLike } from "./hosts.ts";

type RouteValue = unknown | Response | ((url: URL) => unknown | Response);

/**
 * A fake `fetch` answering from recorded fixtures. Keys are matched against
 * `origin + pathname`; JSON-able values become 200 responses.
 */
export function fixtureFetch(routes: Record<string, RouteValue>): FetchLike & { calls: URL[] } {
  const calls: URL[] = [];
  const fn = async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    calls.push(url);
    const key = url.origin + url.pathname;
    if (!(key in routes)) return new Response(`No fixture for ${key}`, { status: 404 });
    const raw = routes[key];
    const value = typeof raw === "function" ? (raw as (u: URL) => unknown)(url) : raw;
    if (value instanceof Response) return value;
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return Object.assign(fn, { calls });
}

export interface TestConnectorOptions<Schema extends z.ZodType> {
  config: z.input<Schema>;
  secrets?: Record<string, string>;
  fetch: FetchLike;
  now?: Date;
}

/** Runs a connector the way the server does: validated config, host-scoped fetch. */
export async function testConnector<Schema extends z.ZodType, Data>(
  connector: Connector<Schema, Data, string>,
  opts: TestConnectorOptions<Schema>,
): Promise<Data> {
  const config = connector.config.parse(opts.config);
  const now = opts.now ?? new Date();
  return connector.fetch({
    config,
    secrets: opts.secrets ?? {},
    fetch: createScopedFetch(connector.hosts, opts.fetch),
    signal: new AbortController().signal,
    now: () => now,
  });
}
