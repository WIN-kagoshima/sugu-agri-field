import { TtlCache } from "../../lib/cache.js";
import { UpstreamError, ValidationError } from "../../lib/errors.js";
import type { Logger } from "../../lib/logger.js";
import type { JmaAdapter, JmaWarning } from "../_interface.js";

/**
 * JMA (Japan Meteorological Agency) Disaster XML adapter.
 *
 * Source: the official Atom feed at
 *   https://www.data.jma.go.jp/developer/xml/feed/extra.xml
 * which lists currently-active 警報・注意報 (warnings/advisories) by
 * prefecture. Each entry links to a per-event XML document under
 *   https://www.data.jma.go.jp/developer/xml/data/.
 *
 * Compliance with the Japan Meteorological Business Act (気象業務法):
 *   1. We MUST attribute the source (`気象庁`).
 *   2. We MUST NOT cache for longer than ~10 minutes; the warning state
 *      can change at any time and stale data could harm operators.
 *   3. We MUST disclose if we modify the data (we don't — we relay the
 *      issuer's headline verbatim).
 *
 * The parser is intentionally minimal: we extract the few fields the
 * tool actually surfaces. Adding `xml2js` or `fast-xml-parser` later is
 * a one-line swap.
 */

const ATTRIBUTION =
  "出典: 気象庁 防災情報 XML フィード（無改変、最大10分キャッシュ）/ Source: JMA Disaster XML feed (unmodified, ≤10 min cache).";

const FEED_URL = "https://www.data.jma.go.jp/developer/xml/feed/extra.xml";
const CACHE_TTL_MS = 10 * 60 * 1000;

interface JmaWarningOptions {
  feedUrl?: string;
  logger?: Logger;
  fetchImpl?: typeof fetch;
}

export class JmaWarningAdapter implements JmaAdapter {
  private readonly feedUrl: string;
  private readonly logger: Logger | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly cache = new TtlCache<string, JmaWarning[]>(CACHE_TTL_MS);
  private fetchedAt: string | null = null;

  constructor(options: JmaWarningOptions = {}) {
    this.feedUrl = options.feedUrl ?? FEED_URL;
    this.logger = options.logger;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getActiveWarnings(input: { prefectureCode?: string }): Promise<{
    warnings: JmaWarning[];
    fetchedAt: string;
    attribution: string;
  }> {
    if (input.prefectureCode && !/^JP-\d{2}$/.test(input.prefectureCode)) {
      throw new ValidationError(
        `prefectureCode must be ISO 3166-2:JP form like "JP-46", got ${JSON.stringify(input.prefectureCode)}`,
      );
    }

    const all = await this.cache.getOrSet(
      "feed",
      async () => {
        const xml = await this.fetchFeedRaw();
        this.fetchedAt = new Date().toISOString();
        return parseFeed(xml);
      },
      CACHE_TTL_MS,
    );

    const filtered = input.prefectureCode
      ? all.filter((w) => w.prefectureCode === input.prefectureCode)
      : all;

    return {
      warnings: filtered,
      fetchedAt: this.fetchedAt ?? new Date().toISOString(),
      attribution: ATTRIBUTION,
    };
  }

  private async fetchFeedRaw(): Promise<string> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.feedUrl, {
        headers: {
          accept: "application/atom+xml, application/xml;q=0.9",
          "user-agent": "sugu-agri-field/0.5.0 (+https://github.com/WIN-kagoshima/sugu-agri-field)",
        },
      });
    } catch (err) {
      throw new UpstreamError("jma", `network failure: ${(err as Error).message}`);
    }
    if (!res.ok) {
      this.logger?.warn("JMA feed returned non-2xx", { status: res.status });
      throw new UpstreamError("jma", `JMA feed returned ${res.status}`);
    }
    return await res.text();
  }
}

/**
 * Parse a JMA `extra.xml` Atom feed into our `JmaWarning[]` shape.
 *
 * Each `<entry>` looks like:
 *
 *   <entry>
 *     <title>気象警報・注意報</title>
 *     <id>urn:uuid:…</id>
 *     <updated>2026-04-30T10:00:00+09:00</updated>
 *     <author><name>鹿児島地方気象台</name></author>
 *     <link href="https://…/data/…/VPWW54_010_…xml" />
 *     <content type="text">大雨警報（土砂災害） 鹿児島県本土 …</content>
 *   </entry>
 *
 * We extract the fields needed for the tool result and infer
 * prefecture code from the issuer name. Errors in individual entries
 * are skipped, not propagated, so a single malformed feed entry
 * cannot break the whole tool.
 */
export function parseFeed(xml: string): JmaWarning[] {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  const out: JmaWarning[] = [];
  for (const entry of entries) {
    const title = textTag(entry, "title") ?? "";
    if (!/警報|注意報|特別警報|情報/.test(title)) continue;
    const author = textTag(entry, "name") ?? "";
    const issuedAt = textTag(entry, "updated") ?? "";
    const link = entry.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? "";
    const content = textTag(entry, "content") ?? "";
    const prefectureCode = inferPrefectureCode(author);
    if (!prefectureCode) continue;
    const severity = inferSeverity(title);
    out.push({
      prefectureCode,
      areaName: extractAreaName(content) ?? author,
      kind: title.trim(),
      severity,
      issuedAt,
      sourceUrl: link,
      headline: content.trim() || null,
    });
  }
  return out;
}

function textTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  if (!m) return null;
  return decodeXml((m[1] ?? "").trim());
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Map "鹿児島地方気象台" → "JP-46". Matches every JMA local office. */
function inferPrefectureCode(author: string): string | null {
  for (const [needle, code] of OFFICE_TO_PREFECTURE) {
    if (author.includes(needle)) return code;
  }
  return null;
}

function inferSeverity(title: string): JmaWarning["severity"] {
  if (title.includes("特別警報")) return "tokubetsu";
  if (title.includes("警報")) return "warning";
  if (title.includes("注意報")) return "advisory";
  return "info";
}

function extractAreaName(content: string): string | null {
  const m = content.match(/[【「『]([^】」』]+)[】」』]/);
  return m?.[1] ?? null;
}

/**
 * JMA local office name → ISO 3166-2:JP prefecture code.
 * Sourced from https://www.jma.go.jp/jma/kishou/intro/gyomu/index2.html.
 */
const OFFICE_TO_PREFECTURE: ReadonlyArray<readonly [string, string]> = [
  ["札幌管区気象台", "JP-01"],
  ["函館", "JP-01"],
  ["旭川", "JP-01"],
  ["室蘭", "JP-01"],
  ["釧路", "JP-01"],
  ["網走", "JP-01"],
  ["稚内", "JP-01"],
  ["青森", "JP-02"],
  ["盛岡", "JP-03"],
  ["仙台管区気象台", "JP-04"],
  ["秋田", "JP-05"],
  ["山形", "JP-06"],
  ["福島", "JP-07"],
  ["水戸", "JP-08"],
  ["宇都宮", "JP-09"],
  ["前橋", "JP-10"],
  ["熊谷", "JP-11"],
  ["銚子", "JP-12"],
  ["気象庁本庁", "JP-13"],
  ["東京管区気象台", "JP-13"],
  ["横浜", "JP-14"],
  ["新潟", "JP-15"],
  ["富山", "JP-16"],
  ["金沢", "JP-17"],
  ["福井", "JP-18"],
  ["甲府", "JP-19"],
  ["長野", "JP-20"],
  ["岐阜", "JP-21"],
  ["静岡", "JP-22"],
  ["名古屋", "JP-23"],
  ["津", "JP-24"],
  ["彦根", "JP-25"],
  ["京都", "JP-26"],
  ["大阪管区気象台", "JP-27"],
  ["神戸", "JP-28"],
  ["奈良", "JP-29"],
  ["和歌山", "JP-30"],
  ["鳥取", "JP-31"],
  ["松江", "JP-32"],
  ["岡山", "JP-33"],
  ["広島", "JP-34"],
  ["下関", "JP-35"],
  ["徳島", "JP-36"],
  ["高松", "JP-37"],
  ["松山", "JP-38"],
  ["高知", "JP-39"],
  ["福岡管区気象台", "JP-40"],
  ["佐賀", "JP-41"],
  ["長崎", "JP-42"],
  ["熊本", "JP-43"],
  ["大分", "JP-44"],
  ["宮崎", "JP-45"],
  ["鹿児島", "JP-46"],
  ["沖縄気象台", "JP-47"],
  ["那覇", "JP-47"],
];
