CREATE OR REPLACE VIEW carbapenemases AS
SELECT DISTINCT
    study, sample, gene_symbol,
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
SELECT DISTINCT study, sample, gene_symbol FROM amr_genes WHERE gene_symbol LIKE 'blaCTX-M%';

CREATE OR REPLACE VIEW sample_families AS
SELECT study, sample, list_sort(list_distinct(list(family))) AS family_list
FROM carbapenemases GROUP BY ALL;

CREATE OR REPLACE VIEW isolates AS
SELECT
    s.study, s.sample, s.run_accession, s.country, s.region,
    coalesce(s.collection_year::INTEGER, k.year::INTEGER) AS collection_year,
    s.source_category, r.st, r.qc_status, k.clone, k.period,
    (SELECT string_agg(c.gene_symbol, ', ' ORDER BY c.gene_symbol) FROM carbapenemases c WHERE c.study = s.study AND c.sample = s.sample) AS carbapenemase_genes,
    (SELECT string_agg(e.gene_symbol, ', ' ORDER BY e.gene_symbol) FROM esbl e WHERE e.study = s.study AND e.sample = s.sample) AS ctxm_genes,
    coalesce(f.family_list, ['none']) AS family_list,
    coalesce(array_to_string(f.family_list, '+'), 'none') AS family_combo,
    f.family_list IS NOT NULL AS has_carbapenemase,
    EXISTS (SELECT 1 FROM esbl e WHERE e.study = s.study AND e.sample = s.sample) AS has_ctxm
FROM samples s
JOIN run_summary r USING (study, sample)
LEFT JOIN cohort k USING (study, sample)
LEFT JOIN sample_families f USING (study, sample);

-- AMR elements with a flag for genes every K. pneumoniae carries on its chromosome
-- (fosA, oqxAB, emrD, kpnEFGH efflux, chromosomal SHV alleles). Acquired fosA3 and ESBL SHVs
-- (e.g. SHV-12) are not flagged. Point mutations count as acquired resistance.
CREATE OR REPLACE VIEW amr_elements AS
SELECT
    g.*,
    (
        g.gene_symbol IN ('emrD', 'fosA', 'blaSHV', 'blaSHV-1', 'blaSHV-11', 'blaSHV-26', 'blaSHV-27', 'blaSHV-28', 'blaSHV-187')
        OR g.gene_symbol LIKE 'oqxA%'
        OR g.gene_symbol LIKE 'oqxB%'
        OR regexp_matches(g.gene_symbol, '^kpn[EFGH]')
    ) AS is_intrinsic
FROM amr_genes g
WHERE g.element_type = 'AMR';
