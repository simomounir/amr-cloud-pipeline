import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("dashboard renders, filters and exports", async ({ page }) => {
  await page.goto("./");
  const isolates = page.getByTestId("headline-isolates");
  await expect(isolates).toHaveText("5");
  for (const panel of ["Resistance over time", "Most common acquired AMR elements", "Isolates"]) {
    await expect(page.getByRole("heading", { name: panel, exact: true })).toBeVisible();
  }
  await expect(page.locator("figure svg").first()).toBeVisible();
  await page.getByRole("checkbox", { name: /Germany/ }).check();
  await expect(isolates).toHaveText("2");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const download = await downloadPromise;
  const text = await readFile(await download.path(), "utf8");
  expect(text.split("\n")[0]).toBe(
    "sample,run_accession,country,collection_year,source_category,st,carbapenemase_genes,ctxm_genes,qc_status",
  );
  expect(text.trim().split("\n")).toHaveLength(3);
  await expect(page.getByText("Public data; demonstrates a method, not surveillance findings.")).toBeVisible();
  // F7's analysis failed: it is counted in the footer, not in any chart or table.
  await expect(page.getByTestId("footer-counts")).toHaveText("6 isolates analysed · 1 failed analysis");
  // The dataset name links to its release notes (study, cost, agreement checks).
  await expect(page.getByRole("link", { name: "dataset-fixture" })).toHaveAttribute(
    "href",
    "https://github.com/simomounir/amr-cloud-pipeline/releases/tag/dataset-fixture",
  );
});

test("timeline axis says it counts per family", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByTestId("headline-isolates")).toHaveText("5");
  await expect(page.locator("figure svg").getByText("Isolates per carbapenemase family", { exact: false })).toBeVisible();
});

test("a ticked filter stays visible when its count drops to zero", async ({ page }) => {
  await page.goto("./");
  const isolates = page.getByTestId("headline-isolates");
  await expect(isolates).toHaveText("5");
  await page.getByRole("checkbox", { name: /United States/ }).check();
  await page.getByRole("checkbox", { name: "Carbapenemase carriers only" }).check();
  await expect(isolates).toHaveText("0");
  const us = page.getByRole("checkbox", { name: /United States \(0\)/ });
  await expect(us).toBeChecked();
  // Unticking makes it disappear again (0 isolates, not selected), so click rather than uncheck().
  await us.click();
  await expect(isolates).toHaveText("3");
  await expect(page.getByRole("checkbox", { name: /United States/ })).toHaveCount(0);
});

test("intrinsic genes are hidden by default and can be shown", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByTestId("headline-isolates")).toHaveText("5");
  await expect(page.getByText(/over-represent resistant, outbreak-associated isolates/)).toBeVisible();
  const chart = page.locator("section", { has: page.getByRole("heading", { name: "Most common acquired AMR elements" }) });
  await expect(chart.locator("svg").getByText("fosA", { exact: true })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Include intrinsic genes" }).check();
  await expect(chart.locator("svg").getByText("fosA", { exact: true })).toHaveCount(1);
});
