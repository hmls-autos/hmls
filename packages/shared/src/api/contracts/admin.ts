import { z } from "zod";
import { contactMethodInput } from "./orders.ts";

// ---------------------------------------------------------------------------
// GET /admin/customers — query string
// ---------------------------------------------------------------------------

export const listCustomersQuery = z.object({
  search: z.string().optional(),
});

// ---------------------------------------------------------------------------
// POST /admin/customers — create customer
// ---------------------------------------------------------------------------

export const createCustomerInput = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  vehicleInfo: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// PATCH /admin/customers/:id — update customer
// ---------------------------------------------------------------------------

export const updateCustomerInput = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  vehicleInfo: z.record(z.string(), z.unknown()).optional(),
  // Nullable so an admin can revoke a stale preference ("stop calling me").
  preferredContact: contactMethodInput.nullish(),
});
