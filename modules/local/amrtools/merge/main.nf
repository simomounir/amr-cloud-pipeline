process AMRTOOLS_MERGE {
    label 'process_single'
    container "${params.amrtools_container}"

    input:
    path genes
    path summaries

    output:
    path 'amr_genes.tsv', emit: genes
    path 'run_summary.tsv', emit: summary

    script:
    """
    amrtools merge --genes ${genes} --summaries ${summaries}
    """
}
