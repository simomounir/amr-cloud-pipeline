WITH shown AS (SELECT * FROM (SELECT country, clone, family_list FROM isolates {{where}}) WHERE country IS NOT NULL)
SELECT country, count(*)::INTEGER AS genomes,
       nullif(array_to_string(list_sort(list_distinct(list(clone))), ', '), '') AS clones,
       array_to_string(list_sort(list_distinct(flatten(list(family_list)))), ', ') AS families
FROM shown
GROUP BY country
ORDER BY genomes DESC, country
