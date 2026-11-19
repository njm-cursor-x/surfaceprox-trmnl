import { networkInterfaces } from "node:os";

/**
 * How phones on the LAN reach this server: `SLATE_BASE_URL` if set (Docker, proxies),
 * else `http://<ip>:<port>` for each non-internal IPv4 address, home ranges first.
 */
export function lanUrls(port: number, env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.SLATE_BASE_URL) return [env.SLATE_BASE_URL.replace(/\/+$/, "")];
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i!.address);
  const rank = (ip: string) =>
    /^(192\.168\.|10\.)/.test(ip) ? 0 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 1 : 2;
  return [...new Set(ips)].sort((a, b) => rank(a) - rank(b)).map((ip) => `http://${ip}:${port}`);
}
