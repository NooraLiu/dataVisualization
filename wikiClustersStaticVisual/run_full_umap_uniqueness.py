#!/usr/bin/env python
import os, argparse, math
import numpy as np
import pandas as pd

from umap import UMAP
from pynndescent import NNDescent

from datasets import load_dataset

try:
    import datashader as ds
    import datashader.transfer_functions as tf
    from PIL import Image
    HAS_DS = True
except Exception:
    HAS_DS = False

def robust_01(x, lo=1.0, hi=99.0):
    lo_v, hi_v = np.percentile(x, [lo, hi])
    return np.clip((x - lo_v) / (hi_v - lo_v + 1e-12), 0.0, 1.0)

def ensure_dir(p):
    d = os.path.dirname(p)
    if d and not os.path.exists(d):
        os.makedirs(d, exist_ok=True)

def load_hf_dataset(input_hf: str, split: str):
    ds = load_dataset(input_hf, split=split)
    keep = [c for c in ds.column_names if c in {"id","url","title","avg_embed"}]
    return ds.select_columns(keep)

def load_parquet_dataset(pq_path: str):
    return load_dataset("parquet", data_files=pq_path, split="train")

def fill_memmap_from_hf(ds, mmap_path, batch=200_000):
    """Write avg_embed to a float32 memmap without building a huge list in RAM."""
    n = len(ds)
    first = ds[0]["avg_embed"]
    d = len(first)
    Xmm = np.memmap(mmap_path, dtype="float32", mode="w+", shape=(n, d))
    ds_np = ds.with_format("numpy", columns=["avg_embed"])
    for start in range(0, n, batch):
        end = min(start + batch, n)
        arr = ds_np[start:end]["avg_embed"].astype("float32", copy=False)
        Xmm[start:end, :] = arr
        print(f"[memmap] wrote {start:,}-{end:,} / {n:,}")
    Xmm.flush()
    return Xmm

def write_parquet_chunks(ds, d1, d2, uniq_z, u01, out_parquet, chunk=200_000):
    """Write (id,title,url,d1,d2,uniq_z,u01) in Parquet by chunks."""
    import pyarrow as pa
    import pyarrow.parquet as pq
    ensure_dir(out_parquet)
    n = len(ds)
    schema = pa.schema([
        pa.field("id", pa.string()),
        pa.field("title", pa.string()),
        pa.field("url", pa.string()),
        pa.field("d1", pa.float32()),
        pa.field("d2", pa.float32()),
        pa.field("uniq_z", pa.float32()),
        pa.field("u01", pa.float32()),
    ])
    writer = pq.ParquetWriter(out_parquet, schema, compression="zstd")
    for start in range(0, n, chunk):
        end = min(start + chunk, n)
        batch = ds[start:end]  
        tbl = pa.table({
            "id":   batch["id"],
            "title":batch["title"],
            "url":  batch["url"],
            "d1":   d1[start:end].astype("float32", copy=False),
            "d2":   d2[start:end].astype("float32", copy=False),
            "uniq_z": uniq_z[start:end].astype("float32", copy=False),
            "u01":    u01[start:end].astype("float32", copy=False),
        }, schema=schema)
        writer.write_table(tbl)
        print(f"parquet wrote rows {start:,}-{end:,} / {n:,}")
    writer.close()
    print(f"parquet wrote {out_parquet}")

def render_datashader_png(parquet_path, out_png, width=800, height=1000):
    if not HAS_DS:
        print("raster datashader not installed; skipping png")
        return
    import pyarrow.parquet as pq
    # Read just the needed columns (low RAM)
    df = pq.read_table(parquet_path, columns=["d1","d2","u01"]).to_pandas(types_mapper={"float": np.float32})
    x_range = (float(df.d1.min()), float(df.d1.max()))
    y_range = (float(df.d2.min()), float(df.d2.max()))
    cvs = ds.Canvas(plot_width=width, plot_height=height, x_range=x_range, y_range=y_range)

    # counts preview
    count = cvs.points(df, "d1", "d2", ds.count())
    print("raster finite pixels (count):", np.isfinite(count.data).sum())

    # uniqueness raster
    agg = cvs.points(df, "d1", "d2", ds.mean("u01"))
    print("raster finite pixels (u01):", np.isfinite(agg.data).sum())

    def green_red_hex(n=256):
        # 0 → green(0,200,0), 1 → red(220,0,0)
        vals = np.linspace(0, 1, n)
        return [f"#{int(0 + t*220):02x}{int(200 - t*200):02x}00" for t in vals]

    img = tf.shade(agg, cmap=green_red_hex(), how="linear", span=(0.0, 1.0), min_alpha=120)
    img = tf.dynspread(img, threshold=0.5, max_px=3)
    img = tf.set_background(img, "white")
    # flipping vertically to match p5 render convention
    img.to_pil().transpose(Image.FLIP_TOP_BOTTOM).save(out_png)
    print(f"raster wrote {out_png}")

def main():
    ap = argparse.ArgumentParser()
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--input-hf", help="HF dataset id, e.g. lsb/enwiki... (requires local cache or network)")
    src.add_argument("--input-parquet", help="Local parquet file with id,title,url,avg_embed")
    ap.add_argument("--split", default="train")
    ap.add_argument("--workdir", default="/scratch/$USER/wiki_umap_work")
    ap.add_argument("--fit-sample", type=int, default=200_000, help="Fit UMAP on this many rows; 0=fit on all")
    ap.add_argument("--n-neighbors", type=int, default=50)
    ap.add_argument("--min-dist", type=float, default=0.05)
    ap.add_argument("--uniq-k", type=int, default=16)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out-parquet", required=True)
    ap.add_argument("--raster-png", default="")  # if set, render PNG
    ap.add_argument("--batch", type=int, default=200_000, help="Batch size for memmap filling and transform")
    args = ap.parse_args()

    workdir = os.path.expandvars(args.workdir)
    os.makedirs(workdir, exist_ok=True)
    X_mmap_path  = os.path.join(workdir, "avg_embed.f32.mmap")
    X2_mmap_path = os.path.join(workdir, "umap2.f32.mmap")

    # 1) load dataset (Arrow-backed)
    if args.input_parquet:
        ds = load_parquet_dataset(args.input_parquet)
    else:
        ds = load_hf_dataset(args.input_hf, args.split)
    n = len(ds)
    print(f"load rows: {n:,}")

    # 2) build a memmap for embeddings (float32)
    if not os.path.exists(X_mmap_path):
        Xmm = fill_memmap_from_hf(ds, X_mmap_path, batch=args.batch)
    else:
        # reopen
        d = len(ds[0]["avg_embed"])
        Xmm = np.memmap(X_mmap_path, dtype="float32", mode="r+", shape=(n, d))
    n, d = Xmm.shape
    print(f"memmap X: shape={Xmm.shape}, bytes≈{Xmm.size * 4 / (1024**3):.2f} GiB")

    # 3) UMAP: fit on sample → transform all (chunked)
    reducer = UMAP(
        n_neighbors=args.n_neighbors,
        min_dist=args.min_dist,
        n_components=2,
        metric="cosine",
        random_state=args.seed,
        low_memory=True
    )
    if args.fit_sample and args.fit_sample < n:
        rng = np.random.default_rng(args.seed)
        sub = rng.choice(n, size=args.fit_sample, replace=False)
        reducer.fit(Xmm[sub])
        print(f"umap fit on sample={len(sub):,}")
    else:
        reducer.fit(Xmm)
        print(f"umap fit on full dataset")

    X2mm = np.memmap(X2_mmap_path, dtype="float32", mode="w+", shape=(n, 2))
    for start in range(0, n, args.batch):
        end = min(start + args.batch, n)
        X2mm[start:end, :] = reducer.transform(Xmm[start:end, :])
        print(f"umap transform {start:,}-{end:,}/{n:,}")
    X2mm.flush()

    # 4) uniqueness on ALL rows in original space
    index = NNDescent(Xmm, metric="cosine", n_neighbors=args.uniq_k + 1,
                      random_state=args.seed, verbose=True)
    _, knn_dist = index.neighbor_graph
    uniq_mean = knn_dist[:, 1:].mean(axis=1).astype("float32")
    uniq_z = (uniq_mean - uniq_mean.mean()) / (uniq_mean.std() + 1e-12)
    u01 = robust_01(uniq_z).astype("float32")
    del index, knn_dist  # free

    # 5) write Parquet (by chunks)
    write_parquet_chunks(
        ds=ds,
        d1=X2mm[:, 0],
        d2=X2mm[:, 1],
        uniq_z=uniq_z,
        u01=u01,
        out_parquet=args.out_parquet,
        chunk=args.batch
    )

    # 6) optional raster
    if args.raster_png:
        render_datashader_png(args.out_parquet, args.raster_png, width=800, height=1000)

    print("done")

if __name__ == "__main__":
    main()
