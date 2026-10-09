import { expect, test } from "@playwright/test";

test("home introduces the project and lists every study", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByText(/Klebsiella pneumoniae/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
  await expect(page.getByTestId("tile-genomes")).toHaveText("8"); // 6 + 2 analysed
  const cards = page.locator(".study-cards").getByRole("link", { name: /Fixture study/ }); // header nav also links studies
  await expect(cards).toHaveCount(2);
  await cards.first().click();
  await expect(page).toHaveURL(/#\/study\/study-a/);
});

test("explore spans both studies and filters by study", async ({ page }) => {
  await page.goto("./#/explore?qc=all");
  await expect(page.getByTestId("headline-isolates")).toHaveText("8");
  await page.getByRole("checkbox", { name: /study-b/ }).check();
  await expect(page.getByTestId("headline-isolates")).toHaveText("2");
});

test("method page renders", async ({ page }) => {
  await page.goto("./#/method");
  await expect(page.getByRole("heading", { name: /How the pipeline works/ })).toBeVisible();
});
