import { describe, expect, it, vi } from "vitest";
import { JmaWarningAdapter, parseFeed } from "../../src/adapters/weather/jma-warning.js";

const SAMPLE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>気象庁防災情報 XML</title>
  <updated>2026-04-30T10:00:00+09:00</updated>
  <entry>
    <title>大雨警報（土砂災害）</title>
    <id>urn:uuid:1111</id>
    <updated>2026-04-30T10:00:00+09:00</updated>
    <author><name>鹿児島地方気象台</name></author>
    <link href="https://www.data.jma.go.jp/developer/xml/data/abc.xml"/>
    <content type="text">【鹿児島県本土】土砂災害の危険度が高まっています。</content>
  </entry>
  <entry>
    <title>高温注意情報</title>
    <id>urn:uuid:2222</id>
    <updated>2026-04-30T09:30:00+09:00</updated>
    <author><name>福岡管区気象台</name></author>
    <link href="https://www.data.jma.go.jp/developer/xml/data/def.xml"/>
    <content type="text">「福岡県」最高気温が35度を超える見込みです。</content>
  </entry>
  <entry>
    <title>東京エリアフィード（無関係なエントリ）</title>
    <id>urn:uuid:3333</id>
    <updated>2026-04-30T09:00:00+09:00</updated>
    <author><name>東京管区気象台</name></author>
    <link href="https://www.data.jma.go.jp/developer/xml/data/ghi.xml"/>
    <content type="text">この行は警報や注意報ではありません</content>
  </entry>
  <entry>
    <title>土砂災害警戒情報</title>
    <id>urn:uuid:4444</id>
    <updated>2026-04-30T11:00:00+09:00</updated>
    <author><name>所属不明</name></author>
    <link href="https://www.data.jma.go.jp/developer/xml/data/jkl.xml"/>
    <content type="text">所属が認識できないエントリは無視される</content>
  </entry>
</feed>
`;

describe("parseFeed", () => {
  it("extracts warning entries with prefecture and severity", () => {
    const out = parseFeed(SAMPLE_FEED);
    expect(out.length).toBe(2);

    const kagoshima = out.find((w) => w.prefectureCode === "JP-46");
    expect(kagoshima).toBeDefined();
    expect(kagoshima?.kind).toBe("大雨警報（土砂災害）");
    expect(kagoshima?.severity).toBe("warning");
    expect(kagoshima?.areaName).toBe("鹿児島県本土");

    const fukuoka = out.find((w) => w.prefectureCode === "JP-40");
    expect(fukuoka).toBeDefined();
    expect(fukuoka?.kind).toBe("高温注意情報");
    expect(fukuoka?.severity).toBe("info");
  });

  it("skips entries whose title does not include 警報・注意報・情報", () => {
    const out = parseFeed(SAMPLE_FEED);
    expect(out.find((w) => w.kind.includes("無関係"))).toBeUndefined();
  });

  it("skips entries whose author cannot be mapped to a prefecture", () => {
    const out = parseFeed(SAMPLE_FEED);
    expect(out.find((w) => w.kind === "土砂災害警戒情報")).toBeUndefined();
  });
});

describe("JmaWarningAdapter", () => {
  it("filters by prefectureCode and includes attribution + fetchedAt", async () => {
    const fakeFetch = vi.fn(async () => new Response(SAMPLE_FEED, { status: 200 }));
    const adapter = new JmaWarningAdapter({ fetchImpl: fakeFetch });
    const result = await adapter.getActiveWarnings({ prefectureCode: "JP-46" });
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]?.prefectureCode).toBe("JP-46");
    expect(result.attribution).toMatch(/気象庁/);
    expect(result.attribution).toMatch(/10/); // 10 min cache disclosure
    expect(result.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns all warnings when prefectureCode is omitted", async () => {
    const fakeFetch = vi.fn(async () => new Response(SAMPLE_FEED, { status: 200 }));
    const adapter = new JmaWarningAdapter({ fetchImpl: fakeFetch });
    const result = await adapter.getActiveWarnings({});
    expect(result.warnings.length).toBe(2);
  });

  it("rejects malformed prefecture codes with ValidationError", async () => {
    const adapter = new JmaWarningAdapter({ fetchImpl: vi.fn() });
    await expect(adapter.getActiveWarnings({ prefectureCode: "JP-999" })).rejects.toThrow(
      /ISO 3166-2:JP/,
    );
  });

  it("caps cache to a single upstream call within the 10-minute window", async () => {
    const fakeFetch = vi.fn(async () => new Response(SAMPLE_FEED, { status: 200 }));
    const adapter = new JmaWarningAdapter({ fetchImpl: fakeFetch });
    await adapter.getActiveWarnings({ prefectureCode: "JP-46" });
    await adapter.getActiveWarnings({ prefectureCode: "JP-40" });
    await adapter.getActiveWarnings({});
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it("turns non-2xx upstream into an UpstreamError", async () => {
    const fakeFetch = vi.fn(async () => new Response("forbidden", { status: 503 }));
    const adapter = new JmaWarningAdapter({ fetchImpl: fakeFetch });
    await expect(adapter.getActiveWarnings({})).rejects.toThrow(/jma|503|unavailable/i);
  });
});
