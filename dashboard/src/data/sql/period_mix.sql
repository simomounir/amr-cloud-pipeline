WITH shown AS (SELECT * FROM (SELECT clone, period, family_combo FROM isolates {{where}}) WHERE clone IS NOT NULL AND period IS NOT NULL),
counted AS (SELECT clone, period, family_combo AS combo, count(*)::INTEGER AS genomes FROM shown GROUP BY ALL)
SELECT clone, period, combo, genomes, (genomes / sum(genomes) OVER (PARTITION BY clone, period))::DOUBLE AS share
FROM counted
ORDER BY clone, period, combo
