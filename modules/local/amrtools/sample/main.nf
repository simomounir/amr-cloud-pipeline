process AMRTOOLS_SAMPLE {
    tag "${meta.id}"
    label 'process_single'
    container "${params.amrtools_container}"

    input:
    tuple val(meta), path(fastp_json), path(contigs), path(amrfinder_tsv), path(kleborate_tsv)
    val amrfinder_version
    val amrfinder_db_version

    output:
    tuple val(meta), path("${meta.id}.amr_genes.tsv"), emit: genes
    tuple val(meta), path("${meta.id}.run_summary.tsv"), emit: summary

    script:
    """
    amrtools sample \\
        --sample ${meta.id} \\
        --sample-type ${meta.sample_type} \\
        --organism ${meta.organism} \\
        --fastp-json ${fastp_json} \\
        --contigs ${contigs} \\
        --amrfinder ${amrfinder_tsv} \\
        --kleborate ${kleborate_tsv} \\
        --amrfinder-version '${amrfinder_version}' \\
        --amrfinder-db-version '${amrfinder_db_version}' \\
        --min-assembly-length ${params.qc_min_assembly_length} \\
        --max-assembly-length ${params.qc_max_assembly_length} \\
        --max-contigs ${params.qc_max_contigs} \\
        --min-q30 ${params.qc_min_q30}
    """

    stub:
    """
    amrtools stub \\
        --sample ${meta.id} \\
        --sample-type ${meta.sample_type} \\
        --organism ${meta.organism}
    """
}
