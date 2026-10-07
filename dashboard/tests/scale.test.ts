import { expect, it } from "vitest";
import { EMPTY_FILTERS } from "../src/data/filters";
import { headline, heatmap, isolateRows, options, timeline } from "../src/data/queries";
import { createViews } from "../src/data/views";
import { emptyConnection } from "./nodeConnection";

// 10,000 synthetic isolates generated in memory only; never written or published.
it("every panel query finishes within a second at 10,000 isolates", async () => {
  const conn = await emptyConnection();
  await conn.query(`CREATE TABLE samples AS
    SELECT 'S' || i AS sample, 'SRR' || i AS run_accession,
           ['Germany','India','United States','Brazil','Italy'][1 + i % 5] AS country, NULL AS region,
           CASE WHEN i % 7 = 0 THEN NULL ELSE 2010 + i % 15 END::SMALLINT AS collection_year,
           ['blood','urine','wound','screening','unknown'][1 + i % 5] AS source_category
    FROM range(10000) t(i)`);
  await conn.query(`CREATE TABLE run_summary AS
    SELECT 'S' || i AS sample, 'ST' || (i % 40) AS st,
           CASE WHEN i % 10 = 0 THEN 'warn' ELSE 'pass' END AS qc_status
    FROM range(10000) t(i)`);
  await conn.query(`CREATE TABLE amr_genes AS
    SELECT 'S' || (i % 10000) AS sample, 'gene' || (i % 60) AS gene_symbol, 'AMR' AS element_type,
           'AMR' AS element_subtype, 'BETA-LACTAM' AS drug_class,
           CASE WHEN i % 9 = 0 THEN 'CARBAPENEM' ELSE 'CEPHALOSPORIN' END AS drug_subclass
    FROM range(440000) t(i)`);
  await createViews(conn);
  for (const query of [headline, timeline, heatmap, isolateRows]) {
    const start = performance.now();
    await query(conn, EMPTY_FILTERS);
    expect(performance.now() - start).toBeLessThan(1000);
  }
  const start = performance.now();
  await options(conn, EMPTY_FILTERS, "countries");
  expect(performance.now() - start).toBeLessThan(1000);
});
