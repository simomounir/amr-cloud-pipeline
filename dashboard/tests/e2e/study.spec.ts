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
  await expect(page.getByRole("heading", { name: "Caveats" })).toBeVisible();
  await expect(page.getByText("Fixture caveat paragraph.")).toBeVisible();
});

test("a study page includes QC-warning genomes by default and the toggle hides them", async ({ page }) => {
  await page.goto("./#/study/study-a");
  await expect(page.getByTestId("isolate-count")).toHaveText("6 isolates"); // F5 is a QC warning
  const toggle = page.getByRole("checkbox", { name: "Include genomes with QC warnings" });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(page.getByTestId("isolate-count")).toHaveText("5 isolates");
  await expect(page).toHaveURL(/qc=pass/);
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByTestId("isolate-count")).toHaveText("5 isolates");
  await toggle.check();
  await expect(page.getByTestId("isolate-count")).toHaveText("6 isolates");
  await expect(page).not.toHaveURL(/qc=/);
});

test("the map caption says how many genomes are not mapped and where countries come from", async ({ page }) => {
  await page.goto("./#/study/study-a");
  const caption = page.locator('[data-figure="map"] > p.note').first();
  await expect(caption).toContainText(/no country in their ENA record and are not mapped/);
  await expect(caption).toContainText("Country as recorded in ENA; the source table assigns countries to all genomes.");
});

test("finding figures only highlight: a heatmap pick does not reshape the period bars", async ({ page }) => {
  await page.goto("./#/study/study-a");
  const bars = page.locator('[data-figure="periods"] svg g[aria-label="bar"] rect');
  await expect(page.getByTestId("isolate-count")).toHaveText("6 isolates");
  const before = await bars.count();
  expect(before).toBeGreaterThan(0);
  await page.locator('[data-figure="heatmap"] svg [aria-label*="ST147"][aria-label*="NDM"]').first().click();
  await expect(page.getByTestId("isolate-count")).toHaveText("2 isolates");
  await expect(bars).toHaveCount(before);
  await expect(page.locator('[data-figure="map"] svg [aria-label="Germany"]').first()).toBeVisible();
});

test("a study without cohort or reference still renders", async ({ page }) => {
  await page.goto("./#/study/study-b");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Fixture study B");
  await expect(page.getByText("No reference calls for this study.")).toBeHidden(); // study-b has no agreement finding
  await expect(page.getByTestId("isolate-count")).toHaveText("2 isolates");
  await expect(page.getByRole("heading", { name: "Caveats" })).toHaveCount(0);
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

test("a mouse click on blank map area picks nothing", async ({ page }) => {
  await page.goto("./#/study/study-a?qc=all");
  const map = page.locator('[data-figure="map"] svg').first();
  await map.locator('[aria-label="Germany"]').first().click();
  const chips = page.locator(".chips .chip:not(.chip-clear)");
  await expect(chips).toHaveCount(1);
  // The South Pacific, far from every dot.
  await map.click({ position: { x: 40, y: 330 } });
  await map.click({ position: { x: 40, y: 330 } });
  await expect(chips).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Remove country Germany" })).toBeVisible();
});

test("a figure's table rows pick like the marks, from the keyboard", async ({ page }) => {
  await page.goto("./#/study/study-a?qc=all");
  const frame = page.locator('[data-figure="heatmap"]');
  await frame.getByText("Show as table").click();
  const row = frame.getByRole("button", { name: "Select ST147 carrying NDM" });
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Remove clone ST147" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove carries NDM" })).toBeVisible();
  await expect(page.getByTestId("isolate-count")).toHaveText("2 isolates");
});

test.describe("touch", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 } });
  test("a tap on a heatmap cell picks it", async ({ page }) => {
    await page.goto("./#/study/study-a?qc=all");
    await page.locator('[data-figure="heatmap"] svg [aria-label*="ST147"][aria-label*="NDM"]').first().tap();
    await expect(page.getByRole("button", { name: "Remove clone ST147" })).toBeVisible();
    await expect(page.getByTestId("isolate-count")).toHaveText("2 isolates");
  });
});
