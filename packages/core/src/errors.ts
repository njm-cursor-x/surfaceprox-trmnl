const NETWORK =
  /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|socket hang up|network/i;
const TIMEOUT = /abort|timed? ?out|timeout|ETIMEDOUT/i;
const STATUS = /\b(?:HTTP|responded|status)\s*(\d{3})\b/i;

/**
 * Turns a raw connector error into text that's fit for a wall display.
 * The raw message stays on the health page for debugging.
 */
export function friendlyError(raw: string, source: string): string {
  if (/allowed hosts/i.test(raw)) return `${source} tried to reach a host it isn't allowed to.`;
  if (TIMEOUT.test(raw)) return `${source} is taking too long to answer. Retrying.`;
  if (NETWORK.test(raw)) return `Can't reach ${source}. Check the network; retrying.`;
  const status = Number(STATUS.exec(raw)?.[1]);
  if (status === 429) return `${source} is limiting requests. Retrying later.`;
  if (status >= 500 && status < 600) return `${source} is having trouble right now. Retrying.`;
  if (status === 401 || status === 403)
    return `${source} rejected the request. Check its settings.`;
  if (status >= 400 && status < 500)
    return `${source} didn't accept the request. Check its settings.`;
  return `Couldn't load data from ${source}. Retrying.`;
}
