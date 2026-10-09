WITH shown AS (SELECT * FROM (SELECT clone, {{period}} AS period, family_list FROM isolates {{where}}) WHERE clone IS NOT NULL AND period IS NOT NULL),
totals AS (SELECT clone, period, count(*)::INTEGER AS genomes FROM shown GROUP BY ALL),
fam AS (SELECT clone, period, unnest(family_list) AS family FROM shown),
carriers AS (SELECT clone, period, family, count(*)::INTEGER AS carriers FROM fam GROUP BY ALL)
SELECT clone, period, family, genomes, carriers, (carriers / genomes)::DOUBLE AS share
FROM carriers JOIN totals USING (clone, period)
ORDER BY clone, period, family
