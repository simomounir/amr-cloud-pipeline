WITH shown AS (SELECT sample, collection_year FROM isolates {{where}})
SELECT
    coalesce(CAST(s.collection_year AS VARCHAR), 'undated') AS year,
    coalesce(c.family, 'none') AS family,
    count(DISTINCT s.sample)::INTEGER AS isolates
FROM shown s
LEFT JOIN carbapenemases c USING (sample)
GROUP BY ALL
ORDER BY year, family
