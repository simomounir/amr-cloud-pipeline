include { FASTP                } from '../modules/nf-core/fastp/main'
include { SHOVILL              } from '../modules/nf-core/shovill/main'
include { AMRFINDERPLUS_UPDATE } from '../modules/nf-core/amrfinderplus/update/main'
include { AMRFINDERPLUS_RUN    } from '../modules/nf-core/amrfinderplus/run/main'
include { KLEBORATE            } from '../modules/local/kleborate/main'
include { AMRTOOLS_SAMPLE      } from '../modules/local/amrtools/sample/main'
include { AMRTOOLS_MERGE       } from '../modules/local/amrtools/merge/main'
include { AMRTOOLS_EXPORT      } from '../modules/local/amrtools/export/main'

workflow ISOLATE {
    take:
    ch_samples     // [meta, [fastq_1, fastq_2]]
    ch_samplesheet // value channel: the samplesheet file

    main:
    FASTP(ch_samples.map { meta, reads -> [meta, reads, []] }, false, false, false)
    SHOVILL(FASTP.out.reads)

    def ch_db = channel.empty()
    if (params.amrfinder_db) {
        ch_db = channel.value(file(params.amrfinder_db, checkIfExists: true))
    } else {
        AMRFINDERPLUS_UPDATE()
        ch_db = AMRFINDERPLUS_UPDATE.out.db.first()
    }

    AMRFINDERPLUS_RUN(SHOVILL.out.contigs, ch_db)
    KLEBORATE(SHOVILL.out.contigs)

    // [meta, fastp_json, contigs, amrfinder_tsv, kleborate_tsv]
    def ch_per_sample = FASTP.out.json
        .join(SHOVILL.out.contigs)
        .join(AMRFINDERPLUS_RUN.out.report)
        .join(KLEBORATE.out.tsv)

    AMRTOOLS_SAMPLE(
        ch_per_sample,
        AMRFINDERPLUS_RUN.out.tool_version.first(),
        AMRFINDERPLUS_RUN.out.db_version.first()
    )

    AMRTOOLS_MERGE(
        AMRTOOLS_SAMPLE.out.genes.map { meta, table -> table }.collect(),
        AMRTOOLS_SAMPLE.out.summary.map { meta, table -> table }.collect()
    )

    AMRTOOLS_EXPORT(ch_samplesheet, AMRTOOLS_MERGE.out.genes, AMRTOOLS_MERGE.out.summary)

    emit:
    genes   = AMRTOOLS_MERGE.out.genes
    summary = AMRTOOLS_MERGE.out.summary
    parquet = AMRTOOLS_EXPORT.out.parquet
}
