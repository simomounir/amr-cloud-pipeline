SELECT value, isolates
FROM (
    SELECT {{column}} AS value, count(*)::INTEGER AS isolates
    FROM isolates
    {{where}}
    GROUP BY 1
)
WHERE value IS NOT NULL
ORDER BY isolates DESC, value
