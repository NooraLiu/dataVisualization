#SBATCH --job-name=wiki-umap-full
#SBATCH --account=def-whkchun            
#SBATCH --time=1-00:00:00                
#SBATCH --cpus-per-task=128              
#SBATCH --mem=740G                       
##SBATCH --partition=cpubase_bynode_b5      
#SBATCH --output=/scratch/%u/logs/%x-%j.out

module load StdEnv/2023
module load python/3.12 arrow/21.0.0
source /home/mcanute/wiki/bin/activate

export OMP_NUM_THREADS=$SLURM_CPUS_PER_TASK
export NUMBA_NUM_THREADS=$SLURM_CPUS_PER_TASK

export HF_HOME=/scratch/$USER/hf_home
export HF_DATASETS_CACHE=$HF_HOME/datasets
export HF_DATASETS_OFFLINE=1

# paths
DATA_DIR=/scratch/$USER/data
WORKDIR=/scratch/$USER/wiki_work
OUT_DIR=/scratch/$USER/out
mkdir -p "$WORKDIR" "$OUT_DIR" /scratch/$USER/logs

echo "Job $SLURM_JOB_ID on $(hostname) at $(date)"
python ~/projects/wiki/run_full_umap_uniqueness.py \
  --input-parquet $DATA_DIR/wiki_avgembeds.parquet \
  --workdir $WORKDIR \
  --fit-sample 200000 \
  --n-neighbors 50 \
  --min-dist 0.05 \
  --uniq-k 16 \
  --seed 42 \
  --out-parquet $OUT_DIR/wiki_umap_full.parquet \
  --raster-png $OUT_DIR/wiki_umap_full.png \
  --batch 200000

echo "finished at $(date)"
