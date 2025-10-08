from datasets import load_dataset
import pandas as pd

# Load the dataset (it will auto-download the first time)
dataset = load_dataset("lsb/enwiki20230101-bysize-minilml6v2-avgembeddings", split="train")

# If the dataset is huge, take a sample
subset = dataset.select(range(100))  # first 100 rows

# Flatten the embeddings: turn avg_embed array into columns d1...dn
def flatten_row(row):
    out = {
        "id": row["id"],
        "url": row["url"],
        "title": row["title"],
        "text": row["text"],
    }
    for i, v in enumerate(row["avg_embed"]):
        out[f"d{i+1}"] = v
    return out

flattened = [flatten_row(r) for r in subset]
df = pd.DataFrame(flattened)

# Save as CSV for p5.js
df.to_csv("wiki_embeddings.csv", index=False)

print("Saved 100 rows to wiki_embeddings.csv")
