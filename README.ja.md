# AgriOps MCP（日本語）

> 公式 MCP Spec 2025-11-25 / MCP Apps Extension 2026-01-26 / MCP TypeScript SDK v1.x に準拠した **参照実装** MCP サーバ。
> Apache-2.0 · TypeScript ESM · Node.js 20+ · stdio + Streamable HTTP。
>
> English: [README.md](./README.md)

AgriOps MCP は、日本の農業データ（eMAFF 筆ポリゴン、Open-Meteo / 気象庁の 1km メッシュ気象、FAMIC 農薬登録情報）を MCP 経由で AI エージェントに公開します。想定ユーザは、農業に特定技能外国人を派遣する派遣会社です。

## ステータス

`1.0.0` 未満は **experimental**。`1.0.0` 到達まではマイナーバージョン間でツール名・引数・リソース URI が変わる可能性があります。詳細は [CHANGELOG.md](./CHANGELOG.md)。

| Phase | バージョン | 主な機能 |
|---|---|---|
| 0 | `0.1.0` | stdio transport · `get_weather_1km` |
| 1 | `0.1.x` | + Streamable HTTP · Server Card · `search_farmland` ほか 4 ツール |
| 2 | `0.2.x` | + ユーザー発火型 prompt 5 本（slash コマンド） |
| 3 | `0.3.x` | + Elicitation Form mode |
| 4 | `0.4.x` | + Elicitation URL mode + OAuth Client Credentials |
| 5 | `0.5.x` | + MCP Apps UI ダッシュボード（地図 + 気象オーバレイ） |

## クイックスタート（stdio）

Node.js 20+ と npm（pnpm/yarn でも可）が必要です。

```bash
git clone https://github.com/WIN-kagoshima/agriops-mcp.git
cd agriops-mcp
npm install
npm run build
npm run dev
```

### Claude Desktop の設定例

```json
{
  "mcpServers": {
    "agriops-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/agriops-mcp/dist/server.js", "--stdio"]
    }
  }
}
```

## クイックスタート（Streamable HTTP, Phase 1+）

```bash
npm run build
npm run start:http        # $PORT (default 3001) で待ち受け
```

公開エンドポイント：

- `POST /mcp` — JSON-RPC over Streamable HTTP
- `GET /mcp` — server-initiated SSE 通知
- `DELETE /mcp` — セッション終了
- `GET /.well-known/mcp-server.json` — Server Card（registries 用）
- `GET /healthz` — ヘルスチェック

## 提供ツール

| 名前 | Phase | 副作用 | 概要 |
|---|---|---|---|
| `get_weather_1km` | 0 | 読み取り | 緯度経度の時間別予報。Open-Meteo（CC-BY 4.0 出典付与） |
| `search_farmland` | 1 | 読み取り | eMAFF 筆ポリゴンを住所・都道府県・作物で検索 |
| `area_summary` | 1 | 読み取り | エリア（行政コード or polygon）の農地統計 |
| `nearby_farms` | 1 | 読み取り | 半径内の近隣農地 |
| `get_pesticide_rules` | 1 | 読み取り | FAMIC の農薬登録情報を作物・病害虫から検索 |
| `create_staff_deploy_plan` | 3 | ドラフト | 派遣計画の草案。情報不足時に Form elicitation で質問 |
| `open_dashboard` | 5 | 読み取り（UI） | MCP Apps UI ダッシュボードを開く。非対応ホストではテキスト fallback |

## Prompt（Phase 2+）

ユーザーが slash コマンドで発火するテンプレート。LLM は自走で発火しません。

| Slash | 必須引数 |
|---|---|
| `/field_summary` | `field_id` |
| `/pesticide_advice` | `crop`, `pest_or_disease` |
| `/staff_deploy_plan` | `farm_ids[]`, `period` |
| `/area_briefing` | `prefecture` |
| `/weather_risk_alert` | `farm_ids[]` |

## データソースとライセンス

詳細は [docs/data-license.md](docs/data-license.md) を参照。

| データソース | ライセンス | 備考 |
|---|---|---|
| eMAFF 筆ポリゴン | オープンデータ | SQLite snapshot をローカルでビルド |
| Open-Meteo | CC-BY 4.0 | API 直叩き。出典をツール出力に明記 |
| FAMIC 農薬登録 | オープンデータ | SQLite snapshot をローカルでビルド |
| 気象庁防災 XML | 気象業務法に基づく利用 | Phase 1+ で短期キャッシュのみ |
| WAGRI | 会員規約 | **本 OSS リリースでは対象外**（Phase 7+ の別パッケージ） |

## ライセンス

Apache-2.0. © 2026 WIN Kagoshima
