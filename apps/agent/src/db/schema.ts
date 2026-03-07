import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const tstzrange = customType<{ data: string; driverParam: string }>({
  dataType() {
    return "tstzrange";
  },
});

export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 255 }),
  address: text("address"),
  vehicleInfo: jsonb("vehicle_info"),
  stripeCustomerId: varchar("stripe_customer_id", { length: 100 }),
  authUserId: varchar("auth_user_id", { length: 255 }).unique(),
  role: varchar("role", { length: 20 }).notNull().default("customer"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const providers = pgTable("providers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 20 }),
  specialties: jsonb("specialties"),
  isActive: boolean("is_active").notNull().default(true),
  serviceRadiusMiles: integer("service_radius_miles").default(30),
  homeBaseLat: numeric("home_base_lat", { precision: 10, scale: 7 }),
  homeBaseLng: numeric("home_base_lng", { precision: 10, scale: 7 }),
  timezone: varchar("timezone", { length: 50 }).notNull().default("America/Los_Angeles"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const providerAvailability = pgTable("provider_availability", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").references(() => providers.id, { onDelete: "cascade" })
    .notNull(),
  dayOfWeek: integer("day_of_week").notNull(),
  // Stored as TIME in DB; varchar here because Drizzle returns TIME as string
  startTime: varchar("start_time", { length: 8 }).notNull(),
  endTime: varchar("end_time", { length: 8 }).notNull(),
});

export const providerScheduleOverrides = pgTable("provider_schedule_overrides", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").references(() => providers.id, { onDelete: "cascade" })
    .notNull(),
  overrideDate: varchar("override_date", { length: 10 }).notNull(),
  isAvailable: boolean("is_available").notNull().default(false),
  startTime: varchar("start_time", { length: 8 }),
  endTime: varchar("end_time", { length: 8 }),
  reason: text("reason"),
});

export const quotes = pgTable("quotes", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => customers.id),
  bookingId: integer("booking_id").references((): AnyPgColumn => bookings.id),
  stripeQuoteId: varchar("stripe_quote_id", { length: 100 }),
  stripeInvoiceId: varchar("stripe_invoice_id", { length: 100 }), // linked invoice after quote accepted
  items: jsonb("items").notNull(), // [{ service, description, amount }]
  totalAmount: integer("total_amount").notNull(), // in cents
  status: varchar("status", { length: 50 }).notNull().default("draft"), // draft, sent, accepted, invoiced, paid
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const pricingConfig = pgTable("pricing_config", {
  key: varchar("key", { length: 50 }).primaryKey(),
  value: integer("value").notNull(),
  description: text("description"),
});

export const estimates = pgTable("estimates", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => customers.id).notNull(),
  items: jsonb("items").notNull(), // LineItem[]
  subtotal: integer("subtotal").notNull(), // in cents
  priceRangeLow: integer("price_range_low").notNull(), // in cents
  priceRangeHigh: integer("price_range_high").notNull(), // in cents
  vehicleInfo: jsonb("vehicle_info"), // {year, make, model}
  notes: text("notes"),
  shareToken: varchar("share_token", { length: 64 }).notNull(),
  validDays: integer("valid_days").notNull().default(14),
  expiresAt: timestamp("expires_at").notNull(),
  convertedToQuoteId: integer("converted_to_quote_id").references(() => quotes.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// NOTE: `scheduledAt` maps to `scheduled_at` — this IS the appointment start time.
// Column was not renamed to preserve backwards compatibility with existing data.
export const bookings = pgTable("bookings", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => customers.id),
  providerId: integer("provider_id").references(() => providers.id),
  serviceType: varchar("service_type", { length: 100 }).notNull(),
  serviceItems: jsonb("service_items").notNull().default([]),
  symptomDescription: text("symptom_description"),
  vehicleYear: integer("vehicle_year"),
  vehicleMake: varchar("vehicle_make", { length: 50 }),
  vehicleModel: varchar("vehicle_model", { length: 50 }),
  vehicleMileage: integer("vehicle_mileage"),
  estimateId: integer("estimate_id").references(() => estimates.id, { onDelete: "cascade" }),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  appointmentEnd: timestamp("appointment_end", { withTimezone: true }),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  blockedRange: tstzrange("blocked_range"),
  location: text("location"),
  locationLat: numeric("location_lat", { precision: 10, scale: 7 }),
  locationLng: numeric("location_lng", { precision: 10, scale: 7 }),
  accessInstructions: text("access_instructions"),
  customerName: varchar("customer_name", { length: 255 }),
  customerEmail: varchar("customer_email", { length: 255 }),
  customerPhone: varchar("customer_phone", { length: 20 }),
  photoUrls: jsonb("photo_urls"),
  customerNotes: text("customer_notes"),
  internalNotes: text("internal_notes"),
  preferredMechanicId: integer("preferred_mechanic_id").references(() => providers.id),
  status: varchar("status", { length: 50 }).notNull().default("requested"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// --- Orders (central entity linking estimate → quote → booking) ---

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => customers.id).notNull(),
  estimateId: integer("estimate_id").references(() => estimates.id, { onDelete: "cascade" }),
  quoteId: integer("quote_id").references(() => quotes.id),
  bookingId: integer("booking_id").references(() => bookings.id),
  status: varchar("status", { length: 30 }).notNull().default("estimated"),
  statusHistory: jsonb("status_history").notNull().default([]),
  adminNotes: text("admin_notes"),
  cancellationReason: text("cancellation_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// --- OLP (Open Labor Project) reference data ---

export const olpVehicles = pgTable("olp_vehicles", {
  id: serial("id").primaryKey(),
  make: varchar("make", { length: 100 }).notNull(),
  makeSlug: varchar("make_slug", { length: 100 }).notNull(),
  model: varchar("model", { length: 100 }).notNull(),
  modelSlug: varchar("model_slug", { length: 100 }).notNull(),
  yearRange: varchar("year_range", { length: 20 }).notNull(),
  yearStart: integer("year_start").notNull(),
  yearEnd: integer("year_end").notNull(),
  engine: varchar("engine", { length: 50 }).notNull(),
  engineSlug: varchar("engine_slug", { length: 50 }).notNull(),
  fuelType: varchar("fuel_type", { length: 20 }),
  timingType: varchar("timing_type", { length: 20 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueVehicle: unique().on(table.makeSlug, table.modelSlug, table.yearRange, table.engineSlug),
}));

export const olpLaborTimes = pgTable("olp_labor_times", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").references(() => olpVehicles.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  slug: varchar("slug", { length: 200 }).notNull(),
  category: varchar("category", { length: 50 }).notNull(),
  laborHours: numeric("labor_hours", { precision: 5, scale: 2 }).notNull(),
}, (table) => ({
  uniqueJob: unique().on(table.vehicleId, table.slug),
}));

// --- Diagnostic tables ---

export const userTierEnum = pgEnum("user_tier", ["free", "plus"]);

export const userProfiles = pgTable(
  "user_profiles",
  {
    id: uuid("id").primaryKey(), // matches auth.users.id
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    tier: userTierEnum("tier").default("free").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("idx_user_profiles_stripe").on(table.stripeCustomerId)],
);

export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => userProfiles.id),
    year: integer("year"),
    make: text("make").notNull(),
    model: text("model").notNull(),
    vin: text("vin"),
    nickname: text("nickname"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("idx_vehicles_user").on(table.userId)],
);

export const sessionStatusEnum = pgEnum("diagnostic_session_status", [
  "pending",
  "processing",
  "complete",
  "failed",
]);

export const mediaTypeEnum = pgEnum("diagnostic_media_type", [
  "photo",
  "audio",
  "video",
  "obd_photo",
]);

export const processingStatusEnum = pgEnum("diagnostic_processing_status", [
  "pending",
  "processing",
  "complete",
  "failed",
]);

export const obdSourceEnum = pgEnum("diagnostic_obd_source", [
  "manual",
  "bluetooth",
  "ocr",
]);

export const diagnosticSessions = pgTable(
  "diagnostic_sessions",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id")
      .references(() => customers.id),
    userId: uuid("user_id").references(() => userProfiles.id),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id),
    status: sessionStatusEnum("status").notNull().default("pending"),
    creditsCharged: integer("credits_charged").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
    result: jsonb("result"),
  },
  (table) => [index("idx_diagnostic_sessions_customer").on(table.customerId)],
);

export const diagnosticMedia = pgTable(
  "diagnostic_media",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => diagnosticSessions.id),
    type: mediaTypeEnum("type").notNull(),
    storageKey: text("r2_key").notNull(),
    creditCost: integer("credit_cost").notNull(),
    metadata: jsonb("metadata"),
    processingStatus: processingStatusEnum("processing_status")
      .notNull()
      .default("pending"),
    transcription: text("transcription"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("idx_diagnostic_media_session").on(table.sessionId)],
);

export const obdCodes = pgTable(
  "diagnostic_obd_codes",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => diagnosticSessions.id),
    code: text("code").notNull(),
    source: obdSourceEnum("source").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("idx_diagnostic_obd_codes_session").on(table.sessionId)],
);

// Diagnostic types
export type UserProfile = typeof userProfiles.$inferSelect;
export type NewUserProfile = typeof userProfiles.$inferInsert;
export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;
export type DiagnosticSession = typeof diagnosticSessions.$inferSelect;
export type NewDiagnosticSession = typeof diagnosticSessions.$inferInsert;
export type DiagnosticMedia = typeof diagnosticMedia.$inferSelect;
export type NewDiagnosticMedia = typeof diagnosticMedia.$inferInsert;
export type ObdCode = typeof obdCodes.$inferSelect;
export type NewObdCode = typeof obdCodes.$inferInsert;
