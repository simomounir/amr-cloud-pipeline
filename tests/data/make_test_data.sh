#!/usr/bin/env bash
# Rebuilds the subsampled reads published as GitHub Release "test-data-v1".
# Usage: tests/data/make_test_data.sh [output_dir]
set -euo pipefail

OUT=${1:-test-data}
TARGET_BASES=110000000 # ~20x of a 5.5 Mb K. pneumoniae genome
SEED=42
SEQTK_IMAGE=quay.io/biocontainers/seqtk:1.5--h577a1d6_1
RUNS=(SRR5386028 ERR14097885 SRR33580217)

mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)

for run in "${RUNS[@]}"; do
    report=$(curl -sf --retry 5 --retry-all-errors --retry-delay 10 "https://www.ebi.ac.uk/ena/portal/api/filereport?accession=${run}&result=read_run&fields=base_count,fastq_ftp&format=tsv" | tail -n 1)
    bases=$(cut -f2 <<<"$report")
    urls=$(cut -f3 <<<"$report" | tr ';' '\n')
    fraction=$(python3 -c "print(min(1.0, ${TARGET_BASES} / ${bases}))")
    echo "${run}: ${bases} bases, keeping fraction ${fraction}"

    for mate in 1 2; do
        url=$(grep "_${mate}.fastq.gz$" <<<"$urls")
        curl -sfL --retry 5 --retry-all-errors --retry-delay 10 "https://${url}" -o "${OUT}/${run}_full_R${mate}.fastq.gz"
        # Same seed for both mates keeps read pairs together.
        docker run --rm --platform linux/amd64 -v "${OUT}:/data" -w /data "$SEQTK_IMAGE" \
            sh -c "seqtk sample -s ${SEED} ${run}_full_R${mate}.fastq.gz ${fraction} | gzip -n > ${run}_R${mate}.fastq.gz"
        rm "${OUT}/${run}_full_R${mate}.fastq.gz"
    done
done

ls -lh "$OUT"
