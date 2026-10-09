// Download one sample's paired reads inside its own task (on Batch: on the worker), instead of
// Nextflow staging every remote file through the head node. A download that keeps failing then
// fails this sample only, like any other per-sample step.
process FETCH_READS {
    tag "${meta.id}"
    label 'process_single'
    container "${params.amrtools_container}"

    input:
    tuple val(meta), val(url_1), val(url_2)

    output:
    tuple val(meta), path("${meta.id}_{1,2}.fastq.gz"), emit: reads

    script:
    def md5_1 = meta.md5_1 ? "--md5 ${meta.md5_1}" : ''
    def md5_2 = meta.md5_2 ? "--md5 ${meta.md5_2}" : ''
    """
    amrtools fetch-reads '${url_1}' --out ${meta.id}_1.fastq.gz ${md5_1}
    amrtools fetch-reads '${url_2}' --out ${meta.id}_2.fastq.gz ${md5_2}
    """

    stub:
    """
    echo "" | gzip > ${meta.id}_1.fastq.gz
    echo "" | gzip > ${meta.id}_2.fastq.gz
    """
}
