import { assertEquals } from "@std/assert";
import { bucketKeys } from "./rate-limit.ts";

Deno.test("bucketKeys — minute + day buckets from a fixed instant", () => {
  const b = bucketKeys(new Date("2026-06-22T16:45:30Z"));
  assertEquals(b.min, "min:2026-06-22T16:45");
  assertEquals(b.day, "day:2026-06-22");
});
