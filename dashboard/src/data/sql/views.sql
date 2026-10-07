CREATE OR REPLACE VIEW carbapenemases AS
SELECT DISTINCT
    sample,
    gene_symbol,
    CASE
        WHEN gene_symbol LIKE 'blaKPC%' THEN 'KPC'
        WHEN gene_symbol LIKE 'blaNDM%' THEN 'NDM'
        WHEN gene_symbol LIKE 'blaVIM%' THEN 'VIM'
        WHEN gene_symbol LIKE 'blaIMP%' THEN 'IMP'
        WHEN gene_symbol LIKE 'blaOXA%' THEN 'OXA-48-like'
        ELSE 'other'
    END AS family
FROM amr_genes
WHERE element_subtype = 'AMR' AND drug_subclass = 'CARBAPENEM';

CREATE OR REPLACE VIEW esbl AS
SELECT DISTINCT sample, gene_symbol
FROM amr_genes
WHERE gene_symbol LIKE 'blaCTX-M%';

CREATE OR REPLACE VIEW isolates AS
SELECT
    s.sample,
    s.run_accession,
    s.country,
    s.region,
    s.collection_year::INTEGER AS collection_year,
    s.source_category,
    r.st,
    r.qc_status,
    (SELECT string_agg(c.gene_symbol, ', ' ORDER BY c.gene_symbol) FROM carbapenemases c WHERE c.sample = s.sample) AS carbapenemase_genes,
    (SELECT string_agg(e.gene_symbol, ', ' ORDER BY e.gene_symbol) FROM esbl e WHERE e.sample = s.sample) AS ctxm_genes,
    EXISTS (SELECT 1 FROM carbapenemases c WHERE c.sample = s.sample) AS has_carbapenemase,
    EXISTS (SELECT 1 FROM esbl e WHERE e.sample = s.sample) AS has_ctxm
FROM samples s
JOIN run_summary r USING (sample);
