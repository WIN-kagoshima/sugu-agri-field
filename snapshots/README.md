# Snapshots

This directory holds **locally built** SQLite snapshots of public data sources.

The actual `*.sqlite` files are **not committed** (see `.gitignore`). They are built reproducibly with:

```bash
npm run snapshots:build
```

See [scripts/build-snapshots/](../scripts/build-snapshots/) for the build steps and [docs/data-license.md](../docs/data-license.md) for the license of each source.

Raw inputs go under `snapshots/raw/` and are ignored by git and Cloud Build:

- `emaff-fude-kagoshima.geojson` or `emaff-fude-kagoshima/*.json`: download manually from the official eMAFF Fude Polygon site after completing the required questionnaire.
- `famic-pesticide.csv`: optional normalized CSV. If absent, the builder also accepts official FAMIC `R*.csv` files extracted under `snapshots/raw/famic*/`.

## Files produced

| File | Source | Built by |
|---|---|---|
| `emaff-fude-kagoshima.sqlite` | 農林水産省 eMAFF 筆ポリゴン (Kagoshima) | `scripts/build-snapshots/build-emaff.ts` |
| `famic-pesticide-2026.sqlite` | FAMIC 農薬登録情報 | `scripts/build-snapshots/build-famic.ts` |

Each `.sqlite` includes an R*Tree spatial index for bounding-box queries.
