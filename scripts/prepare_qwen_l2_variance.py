#!/usr/bin/env python3
"""Prepare compact Qwen L2 value/variance tables for the cartographer view."""

from __future__ import annotations

from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[3]
VIZ_DIR = Path(__file__).resolve().parents[1]
VALUES_PATH = ROOT / "valvar-research-pipeline/outputs/wikipedia_bridge/l1_l2_full/wiki_values.parquet"
MAP_PATH = VIZ_DIR / "influence_data.csv"
SECTION_OUT = VIZ_DIR / "qwen_l2_value_variance_sections.csv"
ARTICLE_OUT = VIZ_DIR / "qwen_l2_value_variance_articles.csv"

LAMBDA_REG = 0.1
N_SECTIONS = 2660


def percentile_rank(series: pd.Series) -> pd.Series:
    if series.empty:
        return series
    return series.rank(method="average", pct=True).fillna(0.5)


def metric_prefix(model_type: str, metric: str) -> str:
    return f"{model_type}_{metric}"


def add_model_metrics(wide: pd.DataFrame, model_type: str) -> pd.DataFrame:
    mask = wide["model_type"] == model_type
    out = wide.loc[mask].copy()
    out[f"{model_type}_value_pctile"] = percentile_rank(out["value_mean"])
    out[f"{model_type}_variance_pctile"] = percentile_rank(out["value_std"])
    rename = {
        "value_mean": metric_prefix(model_type, "value_mean"),
        "value_std": metric_prefix(model_type, "value_std"),
        "n_runs": metric_prefix(model_type, "n_runs"),
    }
    return out.rename(columns=rename).drop(columns=["model_type"])


def main() -> None:
    if not VALUES_PATH.exists():
        raise SystemExit(f"Missing values parquet: {VALUES_PATH}")
    if not MAP_PATH.exists():
        raise SystemExit(f"Missing cartographer data: {MAP_PATH}")

    values = pd.read_parquet(VALUES_PATH)
    values = values[
        (values["model_family"] == "qwen")
        & (values["method"] == "datainf")
        & (values["n_sections"] == N_SECTIONS)
        & (values["lambda_reg"] == LAMBDA_REG)
        & (values["model_type"].isin(["base", "instruct"]))
    ].copy()

    if values.empty:
        raise SystemExit("No Qwen L2 DataInf rows found for the requested filter.")

    map_df = pd.read_csv(MAP_PATH)
    metadata = map_df[
        [
            "id",
            "article_id",
            "article_title",
            "section_path",
            "heading",
            "level",
            "bert_umap1",
            "bert_umap2",
        ]
    ].rename(columns={"id": "section_id"})
    metadata["section_id"] = metadata["section_id"].astype(int)

    values = values.merge(metadata[["section_id", "article_id", "section_path", "level"]], on="section_id", how="left")

    section_summary = (
        values.groupby(["model_type", "section_id"], as_index=False)
        .agg(
            value_mean=("value", "mean"),
            value_std=("value", "std"),
            n_runs=("run_id", "nunique"),
        )
    )
    section_summary["value_std"] = section_summary["value_std"].fillna(0.0)

    section_parts = [add_model_metrics(section_summary, "base"), add_model_metrics(section_summary, "instruct")]
    section_wide = metadata.copy()
    for part in section_parts:
        section_wide = section_wide.merge(part, on="section_id", how="left")

    for col in section_wide.columns:
        if col.endswith("_value_pctile") or col.endswith("_variance_pctile"):
            section_wide[col] = section_wide[col].fillna(0.5)
        elif col.endswith("_value_mean") or col.endswith("_value_std"):
            section_wide[col] = section_wide[col].fillna(0.0)
        elif col.endswith("_n_runs"):
            section_wide[col] = section_wide[col].fillna(0).astype(int)

    section_wide.to_csv(SECTION_OUT, index=False)

    # Article-level values use the mean section value inside each article for each run,
    # then summarize those run-level article averages across seeds.
    run_article = (
        values.groupby(["model_type", "run_id", "article_id"], as_index=False)
        .agg(article_value=("value", "mean"))
    )
    article_summary = (
        run_article.groupby(["model_type", "article_id"], as_index=False)
        .agg(
            value_mean=("article_value", "mean"),
            value_std=("article_value", "std"),
            n_runs=("run_id", "nunique"),
        )
    )
    article_summary["value_std"] = article_summary["value_std"].fillna(0.0)

    article_meta = (
        metadata.groupby(["article_id", "article_title"], as_index=False)
        .agg(
            section_count=("section_id", "nunique"),
            bert_x=("bert_umap1", "mean"),
            bert_y=("bert_umap2", "mean"),
        )
    )

    article_parts = [add_model_metrics(article_summary, "base"), add_model_metrics(article_summary, "instruct")]
    article_wide = article_meta.copy()
    for part in article_parts:
        article_wide = article_wide.merge(part, on="article_id", how="left")

    for col in article_wide.columns:
        if col.endswith("_value_pctile") or col.endswith("_variance_pctile"):
            article_wide[col] = article_wide[col].fillna(0.5)
        elif col.endswith("_value_mean") or col.endswith("_value_std"):
            article_wide[col] = article_wide[col].fillna(0.0)
        elif col.endswith("_n_runs"):
            article_wide[col] = article_wide[col].fillna(0).astype(int)

    article_wide.to_csv(ARTICLE_OUT, index=False)

    print(f"Wrote {SECTION_OUT.relative_to(ROOT)} ({len(section_wide)} rows)")
    print(f"Wrote {ARTICLE_OUT.relative_to(ROOT)} ({len(article_wide)} rows)")


if __name__ == "__main__":
    main()
