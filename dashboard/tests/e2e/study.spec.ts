import { expect, test } from "@playwright/test";

test("study page tells the story and links figures to the table", async ({ page }) => {
  await page.goto("./#/study/study-a?qc=all");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Fixture study A");
  await expect(page.getByRole("heading", { name: /Heatmap finding/ })).toBeVisible();
  await expect(page.getByTestId("isolate-count")).toHaveText("6 isolates");
  // Click the ST147 x NDM heatmap cell (its tip title identifies it).
  await page.locator('[data-figure="heatmap"] svg [aria-label*="ST147"][aria-label*="NDM"]').first().click();
  await expect(page.getByRole("button", { name: "Remove clone ST147" })).toBeVisible();
  await expect(page.getByTestId("isolate-count")).toHaveText("2 isolates");
  await expect(page).toHaveURL(/clone=ST147&family=NDM/);
  // The URL restores the selection.
  await page.reload();
  await expect(page.getByTestId("isolate-count")).toHaveText("2 isolates");
  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(page.getByTestId("isolate-count")).toHaveText("6 isolates");
});

test("a study without cohort or reference still renders", async ({ page }) => {
  await page.goto("./#/study/study-b");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Fixture study B");
  await expect(page.getByText("No reference calls for this study.")).toBeHidden(); // study-b has no agreement finding
  await expect(page.getByTestId("isolate-count")).toHaveText("2 isolates");
});

test("consecutive map picks each apply their own country filter", async ({ page }) => {
  await page.goto("./#/study/study-a?qc=all");
  const map = page.locator('[data-figure="map"] svg');
  await map.locator('[aria-label="Germany"]').first().click();
  await expect(page.getByRole("button", { name: "Remove country Germany" })).toBeVisible();
  await expect(page.getByTestId("isolate-count")).toHaveText("2 isolates");
  await map.locator('[aria-label="India"]').first().click();
  await expect(page.getByRole("button", { name: "Remove country India" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove country Germany" })).toBeHidden();
  await expect(page.getByTestId("isolate-count")).toHaveText("2 isolates");
  await expect(page).toHaveURL(/country=India/);
});
