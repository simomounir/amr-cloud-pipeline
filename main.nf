#!/usr/bin/env nextflow

include { validateParameters; samplesheetToList } from 'plugin/nf-schema'
include { ISOLATE } from './workflows/isolate'

// Relative FASTQ paths resolve against the samplesheet's folder, not the launch folder.
def resolveFastq(value, samplesheetDir) {
    return value.contains('://') || value.startsWith('/') ? file(value) : samplesheetDir.resolve(value)
}

workflow {
    validateParameters()

    def samplesheetDir = file(params.input).parent
    def ch_samples = channel
        .fromList(samplesheetToList(params.input, "${projectDir}/assets/schema_input.json"))
        .map { meta, fastq_1, fastq_2 ->
            [meta + [single_end: false], [resolveFastq(fastq_1, samplesheetDir), resolveFastq(fastq_2, samplesheetDir)]]
        }

    ISOLATE(ch_samples)
}
