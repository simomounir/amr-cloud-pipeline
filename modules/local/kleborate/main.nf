// nf-core's kleborate module pins v2.1.0; this runs Kleborate v3.
process KLEBORATE {
    tag "${meta.id}"
    label 'process_low'
    container 'quay.io/biocontainers/kleborate:3.2.4--pyhdfd78af_1'

    input:
    tuple val(meta), path(contigs)

    output:
    tuple val(meta), path("${meta.id}.kleborate.tsv"), emit: tsv

    script:
    """
    kleborate \\
        --assemblies ${contigs} \\
        --outdir kleborate_out \\
        --preset kpsc \\
        --trim_headers

    # Kleborate writes one main file per detected species complex (plus an
    # hAMRonization file), or none when the assembly is outside the preset.
    # An empty file tells amrtools "no result".
    result=\$(find kleborate_out -name '*_output.txt' ! -name '*hAMRonization*' | head -n 1)
    if [ -n "\$result" ]; then
        cp "\$result" ${meta.id}.kleborate.tsv
    else
        touch ${meta.id}.kleborate.tsv
    fi
    """

    stub:
    """
    touch ${meta.id}.kleborate.tsv
    """
}
