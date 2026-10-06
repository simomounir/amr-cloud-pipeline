#!/usr/bin/env nextflow

include { validateParameters; samplesheetToList } from 'plugin/nf-schema'
include { ISOLATE } from './workflows/isolate'

// Relative FASTQ paths resolve against the samplesheet's folder, not the launch folder.
// Local files are checked here so a typo fails before any process runs.
def resolveFastq(value, samplesheetDir) {
    def remote = value.contains('://')
    def path = remote || value.startsWith('/') || value.startsWith('~') ? file(value) : samplesheetDir.resolve(value)
    if (!remote && !path.exists()) {
        error("FASTQ file not found: ${value} (looked for ${path})")
    }
    return path
}

workflow {
    validateParameters()

    def rows = samplesheetToList(params.input, "${projectDir}/assets/schema_input.json")

    // Output files are named by sample, so names that differ only in case collide
    // on case-insensitive file systems (macOS default).
    def clashes = rows.collect { meta, fastq_1, fastq_2 -> meta.id }
        .groupBy { id -> id.toLowerCase() }
        .findAll { key, ids -> ids.size() > 1 }
        .values()
    if (clashes) {
        error("Sample names must not differ only in case: ${clashes.collect { ids -> ids.join(' / ') }.join(', ')}")
    }

    def samplesheetDir = file(params.input).parent
    def samples = rows.collect { meta, fastq_1, fastq_2 ->
        [meta + [single_end: false], [resolveFastq(fastq_1, samplesheetDir), resolveFastq(fastq_2, samplesheetDir)]]
    }

    ISOLATE(channel.fromList(samples))
}
