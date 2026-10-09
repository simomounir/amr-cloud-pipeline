WITH shown AS (SELECT study, sample, collection_year FROM isolates {{where}})
SELECT
    coalesce(CAST(s.collection_year AS VARCHAR), 'undated') AS year,
    coalesce(c.family, 'none') AS family,
    count(DISTINCT (s.study, s.sample))::INTEGER AS isolates
FROM shown s
LEFT JOIN carbapenemases c USING (study, sample)
GROUP BY ALL
ORDER BY year, family
