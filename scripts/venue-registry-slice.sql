-- scripts/venue-registry-slice.sql
-- Local-only (DuckDB CLI): slices Overture places to Milwaukee metro as JSONL.
-- Usage: duckdb -init /dev/null -batch < scripts/venue-registry-slice.sql
-- Then:  npm run registry:import /tmp/overture-mke.jsonl
INSTALL httpfs; LOAD httpfs;
SET s3_region='us-west-2';
COPY (
  SELECT
    id,
    names.primary AS name,
    categories.primary AS category,
    addresses[1].freeform AS address,
    addresses[1].locality AS locality,
    bbox.xmin AS lon,
    bbox.ymin AS lat,
    confidence
  FROM read_parquet('s3://overturemaps-us-west-2/release/2026-05-20.0/theme=places/type=place/*', hive_partitioning=1)
  WHERE bbox.xmin > -88.6 AND bbox.xmax < -87.7
    AND bbox.ymin > 42.6  AND bbox.ymax < 43.45
    AND names.primary IS NOT NULL
) TO '/tmp/overture-mke.jsonl' (FORMAT JSON);
