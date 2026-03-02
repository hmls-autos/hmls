import { Hono } from "hono";
import { renderToStream } from "@react-pdf/renderer";
import { db } from "../db/client.ts";
import * as schema from "../db/schema.ts";
import { and, eq } from "drizzle-orm";
import { EstimatePdf } from "../pdf/EstimatePdf.tsx";
import { Errors } from "@hmls/shared/errors";
import { type AuthEnv, requireAuth } from "../middleware/auth.ts";

const estimates = new Hono<AuthEnv>();

// GET estimate by ID (authenticated, owner-only)
estimates.get("/:id", requireAuth, async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "Invalid estimate ID" } },
      400,
    );
  }

  const customerId = c.get("customerId");
  const [estimate] = await db
    .select()
    .from(schema.estimates)
    .where(eq(schema.estimates.id, id))
    .limit(1);

  if (!estimate) throw Errors.notFound("Estimate", id);

  if (estimate.customerId !== customerId) {
    return c.json(
      { error: { code: "FORBIDDEN", message: "Not authorized to view this estimate" } },
      403,
    );
  }

  return c.json(estimate);
});

// GET estimate PDF (share-token for public access, or authenticated owner)
estimates.get("/:id/pdf", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "Invalid estimate ID" } },
      400,
    );
  }

  const token = c.req.query("token");

  // Single JOIN: estimate + customer in one query
  const [row] = await db
    .select({
      estimate: schema.estimates,
      customerName: schema.customers.name,
      customerPhone: schema.customers.phone,
      customerEmail: schema.customers.email,
      customerAddress: schema.customers.address,
      customerVehicleInfo: schema.customers.vehicleInfo,
    })
    .from(schema.estimates)
    .leftJoin(schema.customers, eq(schema.estimates.customerId, schema.customers.id))
    .where(
      token
        ? and(
          eq(schema.estimates.id, id),
          eq(schema.estimates.shareToken, token),
        )
        : eq(schema.estimates.id, id),
    )
    .limit(1);

  if (!row) throw Errors.notFound("Estimate", id);

  const estimate = row.estimate;
  const customer = {
    name: row.customerName,
    phone: row.customerPhone,
    email: row.customerEmail,
    address: row.customerAddress,
    vehicleInfo: row.customerVehicleInfo as { make?: string; model?: string; year?: string } | null,
  };

  const pdfStream = await renderToStream(
    EstimatePdf({
      estimate: {
        ...estimate,
        items: estimate.items as {
          name: string;
          description: string;
          price: number;
        }[],
      },
      customer,
    }),
  );

  return new Response(pdfStream as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="HMLS-Estimate-${id}.pdf"`,
    },
  });
});

export { estimates };
