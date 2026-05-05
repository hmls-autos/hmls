import { describe, expect, test } from "bun:test";
import {
  buildCreateOrderPayload,
  emptyManualOrderForm,
  validateManualOrderForm,
} from "./admin-create-order";

describe("manual admin order creation", () => {
  test("requires an existing customer before building an order", () => {
    expect(validateManualOrderForm(emptyManualOrderForm())).toEqual(
      "Choose a customer before creating the order.",
    );
  });

  test("requires a service description or order notes", () => {
    const form = { ...emptyManualOrderForm(), customerId: "42" };
    expect(validateManualOrderForm(form)).toEqual(
      "Add order notes or at least one service item.",
    );
  });

  test("builds a POST /orders payload from trimmed form values", () => {
    const form = {
      ...emptyManualOrderForm(),
      customerId: "42",
      vehicleYear: "2020",
      vehicleMake: " Toyota ",
      vehicleModel: " Camry ",
      description: "  Customer reports brake noise. ",
      itemDescription: " Front brake inspection ",
      laborHours: "1.5",
      partsCost: "89.99",
    };

    expect(validateManualOrderForm(form)).toBeNull();
    expect(buildCreateOrderPayload(form)).toEqual({
      customer_id: 42,
      vehicle_year: 2020,
      vehicle_make: "Toyota",
      vehicle_model: "Camry",
      description: "Customer reports brake noise.",
      items: [
        {
          description: "Front brake inspection",
          labor_hours: 1.5,
          parts_cost: 89.99,
        },
      ],
    });
  });

  test("omits empty optional fields from the payload", () => {
    const form = {
      ...emptyManualOrderForm(),
      customerId: "7",
      description: "Quick diagnostic",
    };

    expect(buildCreateOrderPayload(form)).toEqual({
      customer_id: 7,
      description: "Quick diagnostic",
    });
  });
});
