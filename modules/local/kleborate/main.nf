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
    # Prefer the K. pneumoniae complex file; otherwise take the first in sorted order.
    # An empty file tells amrtools "no result".
    result=kleborate_out/klebsiella_pneumo_complex_output.txt
    if [ ! -f "\$result" ]; then
        result=\$(find kleborate_out -name '*_output.txt' ! -name '*hAMRonization*' | sort | head -n 1)
    fi
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
