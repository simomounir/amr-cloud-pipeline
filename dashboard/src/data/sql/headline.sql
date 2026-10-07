SELECT
    count(*)::INTEGER AS isolates,
    coalesce(avg(has_carbapenemase::INTEGER), 0)::DOUBLE AS carbapenemase_share,
    coalesce(avg(has_ctxm::INTEGER), 0)::DOUBLE AS ctxm_share,
    count(DISTINCT country)::INTEGER AS countries,
    min(collection_year)::INTEGER AS year_min,
    max(collection_year)::INTEGER AS year_max,
    coalesce(avg((collection_year IS NOT NULL)::INTEGER), 0)::DOUBLE AS year_known_share
FROM isolates
{{where}}
