import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("dashboard renders, filters and exports", async ({ page }) => {
  await page.goto("./#/explore?study=study-a");
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
    "study,sample,run_accession,country,collection_year,source_category,st,carbapenemase_genes,ctxm_genes,qc_status",
  );
  expect(text.trim().split("\n")).toHaveLength(3);
  await expect(page.getByText("Public data; demonstrates a method, not surveillance findings.")).toBeVisible();
  // F7's analysis failed: it is counted in the footer, not in any chart or table.
  await expect(page.getByTestId("footer-counts-study-a")).toHaveText("study-a: 6 analysed · 1 failed analysis");
  // The dataset name links to its release notes (study, cost, agreement checks).
  await expect(page.getByRole("link", { name: "dataset-study-a-2026-10-01" })).toHaveAttribute(
    "href",
    "https://github.com/simomounir/amr-cloud-pipeline/releases/tag/dataset-study-a-2026-10-01",
  );
});

test("timeline axis says it counts per family", async ({ page }) => {
  await page.goto("./#/explore?study=study-a");
  await expect(page.getByTestId("headline-isolates")).toHaveText("5");
  await expect(page.locator("figure svg").getByText("Isolates per carbapenemase family", { exact: false })).toBeVisible();
});

test("a ticked filter stays visible when its count drops to zero", async ({ page }) => {
  await page.goto("./#/explore?study=study-a");
  const isolates = page.getByTestId("headline-isolates");
  await expect(isolates).toHaveText("5");
  await page.getByRole("checkbox", { name: /United States/ }).check();
  await page.getByRole("checkbox", { name: "Carbapenemase carriers only" }).check();
  await expect(isolates).toHaveText("0");
  const us = page.getByRole("checkbox", { name: /United States \(0\)/ });
  await expect(us).toBeChecked();
  // Unticking makes it disappear again (0 isolates, not selected), so click rather than uncheck().
  await us.click();
  await expect(isolates).toHaveText("3"); // study-a carbapenemase carriers (60% of 5)
  await expect(page.getByRole("checkbox", { name: /United States/ })).toHaveCount(0);
});

test("intrinsic genes are hidden by default and can be shown", async ({ page }) => {
  await page.goto("./#/explore?study=study-a");
  await expect(page.getByTestId("headline-isolates")).toHaveText("5");
  await expect(page.getByText(/over-represent resistant, outbreak-associated isolates/)).toBeVisible();
  const chart = page.locator("section", { has: page.getByRole("heading", { name: "Most common acquired AMR elements" }) });
  await expect(chart.locator("svg").getByText("fosA", { exact: true })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Include intrinsic genes" }).check();
  await expect(chart.locator("svg").getByText("fosA", { exact: true })).toHaveCount(1);
});

test("header navigates between pages and toggles dark mode", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("link", { name: "Explore" }).click();
  await expect(page).toHaveURL(/#\/explore/);
  await page.getByRole("button", { name: /Switch to dark mode/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("an unknown study route says so and links home", async ({ page }) => {
  await page.goto("./#/study/nope");
  await expect(page.getByRole("heading", { name: "No such study" })).toBeVisible();
  await page.getByRole("link", { name: "Back to the home page" }).click();
  await expect(page).toHaveURL(/#\/$/);
});

test("chart tooltips follow the theme in dark mode", async ({ page }) => {
  await page.goto("./#/explore?study=study-a");
  await expect(page.getByTestId("headline-isolates")).toHaveText("5");
  await page.getByRole("button", { name: /Switch to dark mode/ }).click();
  const figure = page.locator("figure").first();
  await figure.locator("g[aria-label='bar'] rect").first().hover();
  const tip = figure.locator("g[aria-label='tip'] path").first();
  await expect(tip).toBeVisible();
  const fill = await tip.evaluate((p) => getComputedStyle(p).fill);
  expect(fill).not.toBe("rgb(255, 255, 255)");
  expect(fill).toBe("rgb(22, 28, 35)");
});
