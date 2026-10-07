import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("dashboard renders, filters and exports", async ({ page }) => {
  await page.goto("./");
  const isolates = page.getByTestId("headline-isolates");
  await expect(isolates).toHaveText("5");
  for (const panel of ["Resistance over time", "Most common AMR elements", "Isolates"]) {
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
});
