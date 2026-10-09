import { expect, test } from "vitest";
import { isParquetAt } from "../src/data/tables";

test("isParquetAt asks for the first four bytes and bypasses the HTTP cache", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response("PAR1");
  }) as unknown as typeof fetch;
  expect(await isParquetAt("https://x.org/data/s/cohort.parquet", fetchFn)).toBe(true);
  expect(calls).toHaveLength(1);
  expect(calls[0].init?.cache).toBe("no-store");
  expect(new Headers(calls[0].init?.headers).get("Range")).toBe("bytes=0-3");
});

test("isParquetAt is false for a 404, an HTML page and a network error", async () => {
  const respond = (r: () => Response | Promise<Response>) => (async () => r()) as unknown as typeof fetch;
  expect(await isParquetAt("u", respond(() => new Response("", { status: 404 })))).toBe(false);
  expect(await isParquetAt("u", respond(() => new Response("<html>")))).toBe(false);
  expect(await isParquetAt("u", respond(() => Promise.reject(new Error("offline"))))).toBe(false);
});
