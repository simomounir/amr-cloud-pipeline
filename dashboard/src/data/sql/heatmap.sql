WITH shown AS (SELECT sample FROM isolates {{where}}),
hits AS (
    SELECT g.gene_symbol, coalesce(g.drug_class, 'unknown') AS drug_class, count(DISTINCT g.sample) AS carriers
    FROM amr_genes g
    JOIN shown USING (sample)
    WHERE g.element_type = 'AMR'
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
