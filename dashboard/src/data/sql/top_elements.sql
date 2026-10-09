WITH shown AS (SELECT study, sample FROM isolates {{where}}),
hits AS (
    SELECT e.gene_symbol, coalesce(e.drug_class, 'unknown') AS drug_class, count(DISTINCT (e.study, e.sample)) AS carriers
    FROM amr_elements e
    JOIN shown USING (study, sample)
    WHERE TRUE {{intrinsic}}
    GROUP BY ALL
)
SELECT
    gene_symbol,
    drug_class,
    carriers::INTEGER AS carriers,
    (carriers / (SELECT count(*) FROM shown))::DOUBLE AS share
FROM hits
ORDER BY carriers DESC, gene_symbol
LIMIT 20
