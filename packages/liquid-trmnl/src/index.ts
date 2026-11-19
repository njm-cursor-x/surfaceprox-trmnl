import { Liquid } from "liquidjs";
import {
  daysAgo,
  findBy,
  groupBy,
  numberToCurrency,
  numberWithDelimiter,
  ordinalize,
  parseJson,
  pluralize,
  timeAgo,
  wmoLabel,
} from "./filters.ts";

export * as filters from "./filters.ts";

const TEMPLATE_BLOCK =
  /\{%-?\s*template\s+([\w./-]+)\s*-?%\}([\s\S]*?)\{%-?\s*endtemplate\s*-?%\}/g;

/**
 * Pulls TRMNL `{% template name %}…{% endtemplate %}` blocks out of a source so they
 * can be served as in-memory partials for `{% render "name" %}`.
 */
export function extractTemplates(source: string): {
  body: string;
  partials: Record<string, string>;
} {
  const partials: Record<string, string> = {};
  const body = source.replace(TEMPLATE_BLOCK, (_, name: string, content: string) => {
    partials[name] = content;
    return "";
  });
  return { body, partials };
}

export interface RenderOptions {
  /** TRMNL `shared.liquid`: prepended, and its `{% template %}` blocks become partials. */
  shared?: string;
  /** Extra partials, e.g. extension templates keyed as `clock.face/digital`. */
  partials?: Record<string, string>;
  now?: () => Date;
}

export function createLiquid(
  partials: Record<string, string> = {},
  now: () => Date = () => new Date(),
): Liquid {
  const engine = new Liquid({
    templates: partials,
    extname: "",
    jsTruthy: false,
    ownPropertyOnly: true,
    // Unlike TRMNL, `{{ }}` output is HTML-escaped; recipes that emit markup use `| raw`.
    outputEscape: "escape",
    renderLimit: 2_000,
    parseLimit: 1_000_000,
    memoryLimit: 64_000_000,
  });
  engine.registerFilter("number_with_delimiter", numberWithDelimiter);
  engine.registerFilter("number_to_currency", numberToCurrency);
  engine.registerFilter("pluralize", pluralize);
  engine.registerFilter("ordinalize", ordinalize);
  engine.registerFilter("days_ago", (v: unknown) => daysAgo(v, now()));
  engine.registerFilter("time_ago", (v: unknown) => timeAgo(v, now()));
  engine.registerFilter("group_by", groupBy);
  engine.registerFilter("find_by", findBy);
  engine.registerFilter("parse_json", parseJson);
  engine.registerFilter("json", (v: unknown) => JSON.stringify(v));
  engine.registerFilter("wmo_label", wmoLabel);
  return engine;
}

/** Renders a TRMNL layout template with its shared partials. */
export async function renderTrmnl(
  source: string,
  context: Record<string, unknown>,
  opts: RenderOptions = {},
): Promise<string> {
  const shared = extractTemplates(opts.shared ?? "");
  const own = extractTemplates(source);
  const engine = createLiquid({ ...opts.partials, ...shared.partials, ...own.partials }, opts.now);
  return engine.parseAndRender(shared.body + own.body, context);
}
