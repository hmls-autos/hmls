import { assertEquals, assertThrows } from "@std/assert";
import { pickScopeConfig } from "./client.ts";

Deno.test("pickScopeConfig: customer identity wins over shop", () => {
  assertEquals(pickScopeConfig({ customerId: 42, shopId: "shop-uuid" }), {
    setting: "app.customer_id",
    value: "42",
  });
});

Deno.test("pickScopeConfig: concrete shop scopes by shop", () => {
  assertEquals(pickScopeConfig({ shopId: "shop-uuid" }), {
    setting: "app.shop_id",
    value: "shop-uuid",
  });
});

Deno.test("pickScopeConfig: empty context is fail-closed", () => {
  assertThrows(() => pickScopeConfig({}), Error, "fail-closed");
});
