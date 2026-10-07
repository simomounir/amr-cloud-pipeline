SELECT sample, run_accession, country, collection_year, source_category, st,
       carbapenemase_genes, ctxm_genes, qc_status
FROM isolates
{{where}}
ORDER BY sample
