import type { z } from "zod";
import { parseDuration, type Duration } from "./duration.ts";
import type { FetchLike } from "./hosts.ts";

export interface SecretSpec {
  label: string;
  required?: boolean;
  help?: string;
}

export interface QuotaLimits {
  perMinute?: number;
  perHour?: number;
  perDay?: number;
}

export interface ConnectorContext<Config, Secrets> {
  config: Config;
  secrets: Secrets;
  /** Host-restricted fetch: only the connector's declared `hosts` are reachable. */
  fetch: FetchLike;
  signal: AbortSignal;
  now: () => Date;
}

export interface ConnectorDefinition<
  Schema extends z.ZodType = z.ZodType,
  Data = unknown,
  SecretKeys extends string = string,
> {
  id: string;
  name?: string;
  config: Schema;
  secrets?: Record<SecretKeys, SecretSpec>;
  /** Hosts the injected `fetch` may reach. `"*.example.com"` allows subdomains. */
  hosts: readonly string[];
  refresh: { every: Duration; min?: Duration };
  quota?: QuotaLimits;
  fetch(
    ctx: ConnectorContext<z.infer<Schema>, Record<SecretKeys, string | undefined>>,
  ): Promise<Data>;
}

export interface Connector<
  Schema extends z.ZodType = z.ZodType,
  Data = unknown,
  SecretKeys extends string = string,
> extends ConnectorDefinition<Schema, Data, SecretKeys> {
  readonly kind: "connector";
  readonly refreshMs: number;
  readonly minRefreshMs: number;
}

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export function defineConnector<Schema extends z.ZodType, Data, SecretKeys extends string = never>(
  def: ConnectorDefinition<Schema, Data, SecretKeys>,
): Connector<Schema, Data, SecretKeys> {
  if (!ID_RE.test(def.id)) throw new Error(`Connector id "${def.id}" must be kebab-case`);
  if (typeof def.fetch !== "function") throw new Error(`Connector "${def.id}" needs a fetch()`);
  const refreshMs = parseDuration(def.refresh.every);
  const minRefreshMs = def.refresh.min === undefined ? refreshMs : parseDuration(def.refresh.min);
  if (minRefreshMs > refreshMs) {
    throw new Error(`Connector "${def.id}": refresh.min must not exceed refresh.every`);
  }
  return Object.freeze({ ...def, kind: "connector" as const, refreshMs, minRefreshMs });
}
