process AMRTOOLS_EXPORT {
    label 'process_single'
    container "${params.amrtools_container}"

    input:
    path samplesheet
    path genes
    path summary

    output:
    path 'parquet/*.parquet', emit: parquet
    path 'samples.tsv', emit: samples_tsv

    script:
    """
    amrtools export \\
        --samplesheet ${samplesheet} \\
        --genes ${genes} \\
        --summary ${summary} \\
        --run-id '${workflow.sessionId}' \\
        --run-started-at '${workflow.start.toInstant()}' \\
        --outdir parquet \\
        --samples-tsv samples.tsv
    """
}
