FROM python:3.12-slim

# Nextflow runs `ps` inside task containers to collect resource metrics.
RUN apt-get update \
    && apt-get install -y --no-install-recommends procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/amrtools
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir .

LABEL org.opencontainers.image.source="https://github.com/simomounir/amr-cloud-pipeline"
