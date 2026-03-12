// apps/agent/src/pdf/EstimatePdf.tsx

// deno-lint-ignore verbatim-module-syntax
import React from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#1a1a1a",
    backgroundColor: "#ffffff",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 30,
    paddingBottom: 20,
    borderBottomWidth: 2,
    borderBottomColor: "#dc2626",
  },
  logo: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#dc2626",
  },
  logoSubtext: {
    fontSize: 10,
    color: "#666666",
    marginTop: 4,
  },
  titleSection: {
    textAlign: "right",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#1a1a1a",
  },
  estimateNumber: {
    fontSize: 10,
    color: "#666666",
    marginTop: 4,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#dc2626",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  customerInfo: {
    backgroundColor: "#f9fafb",
    padding: 15,
    borderRadius: 4,
  },
  customerName: {
    fontSize: 14,
    fontWeight: "bold",
    marginBottom: 4,
  },
  customerDetail: {
    fontSize: 10,
    color: "#666666",
    marginBottom: 2,
  },
  vehicleInfo: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  table: {
    marginTop: 10,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    padding: 10,
    fontWeight: "bold",
    fontSize: 10,
  },
  tableRow: {
    flexDirection: "row",
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  colService: {
    flex: 2,
  },
  colDescription: {
    flex: 3,
  },
  colPrice: {
    flex: 1,
    textAlign: "right",
  },
  totalSection: {
    marginTop: 20,
    paddingTop: 15,
    borderTopWidth: 2,
    borderTopColor: "#dc2626",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 8,
  },
  totalLabel: {
    fontSize: 12,
    marginRight: 20,
  },
  totalValue: {
    fontSize: 12,
    fontWeight: "bold",
    width: 100,
    textAlign: "right",
  },
  rangeValue: {
    fontSize: 10,
    color: "#666666",
    width: 100,
    textAlign: "right",
  },
  footer: {
    marginTop: "auto",
    paddingTop: 20,
  },
  termsTitle: {
    fontSize: 10,
    fontWeight: "bold",
    marginBottom: 6,
  },
  termsText: {
    fontSize: 8,
    color: "#4b5563",
    lineHeight: 1.5,
    marginBottom: 4,
  },
  termsBox: {
    padding: 10,
    backgroundColor: "#f9fafb",
    borderRadius: 4,
    marginBottom: 10,
  },
  cta: {
    fontSize: 10,
    textAlign: "center",
    marginBottom: 10,
  },
  contact: {
    fontSize: 9,
    color: "#666666",
    textAlign: "center",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 10,
  },
});

interface LineItem {
  name: string;
  description: string;
  price: number;
}

interface Customer {
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  vehicleInfo: {
    make?: string;
    model?: string;
    year?: string;
  } | null;
}

interface Estimate {
  id: number;
  items: LineItem[];
  subtotal: number;
  priceRangeLow: number;
  priceRangeHigh: number;
  notes: string | null;
  expiresAt: Date;
  createdAt: Date;
}

interface EstimatePdfProps {
  estimate: Estimate;
  customer: Customer;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatVehicle(vehicleInfo: Customer["vehicleInfo"]): string {
  if (!vehicleInfo) return "Not specified";
  const parts = [vehicleInfo.year, vehicleInfo.make, vehicleInfo.model].filter(
    Boolean,
  );
  return parts.join(" ") || "Not specified";
}

export function EstimatePdf({ estimate, customer }: EstimatePdfProps) {
  const items = estimate.items as LineItem[];

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.logo}>HMLS</Text>
            <Text style={styles.logoSubtext}>Mobile Mechanic</Text>
          </View>
          <View style={styles.titleSection}>
            <Text style={styles.title}>ESTIMATE</Text>
            <Text style={styles.estimateNumber}>#{estimate.id}</Text>
            <Text style={styles.estimateNumber}>
              {formatDate(estimate.createdAt)}
            </Text>
          </View>
        </View>

        {/* Customer Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Prepared For</Text>
          <View style={styles.customerInfo}>
            <Text style={styles.customerName}>
              {customer.name || "Customer"}
            </Text>
            {customer.phone && <Text style={styles.customerDetail}>{customer.phone}</Text>}
            {customer.email && <Text style={styles.customerDetail}>{customer.email}</Text>}
            {customer.address && <Text style={styles.customerDetail}>{customer.address}</Text>}
            <View style={styles.vehicleInfo}>
              <Text style={styles.customerDetail}>
                Vehicle: {formatVehicle(customer.vehicleInfo)}
              </Text>
            </View>
          </View>
        </View>

        {/* Line Items */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Services</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={styles.colService}>Service</Text>
              <Text style={styles.colDescription}>Description</Text>
              <Text style={styles.colPrice}>Price</Text>
            </View>
            {items.map((item, index) => (
              <View key={index} style={styles.tableRow}>
                <Text style={styles.colService}>{item.name}</Text>
                <Text style={styles.colDescription}>{item.description}</Text>
                <Text style={styles.colPrice}>{formatPrice(item.price)}</Text>
              </View>
            ))}
          </View>

          {/* Totals */}
          <View style={styles.totalSection}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal:</Text>
              <Text style={styles.totalValue}>
                {formatPrice(estimate.subtotal)}
              </Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Estimated Range:</Text>
              <Text style={styles.rangeValue}>
                {formatPrice(estimate.priceRangeLow)} - {formatPrice(estimate.priceRangeHigh)}
              </Text>
            </View>
          </View>
        </View>

        {/* Notes */}
        {estimate.notes && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text>{estimate.notes}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.cta}>
            Ready to proceed? Reply in chat or call us to schedule your service.
          </Text>
          <Text style={styles.contact}>
            HMLS Mobile Mechanic | Orange County, CA | Mon-Sat 8AM-12AM
          </Text>
        </View>
      </Page>

      {/* Page 2: Terms & Conditions */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.termsBox}>
          <Text style={styles.termsTitle}>Terms &amp; Conditions</Text>
          <Text style={styles.termsText}>
            1. Authorization: By proceeding with this estimate, you authorize HMLS Mobile Mechanic
            to perform the services listed above.
          </Text>
          <Text style={styles.termsText}>
            2. Warranty: All parts and labor are covered by a 90-day (3-month) warranty from the
            date of service. Warranty does not cover normal wear and tear, misuse, or pre-existing
            conditions not addressed in this estimate.
          </Text>
          <Text style={styles.termsText}>
            3. Cost Overages: If additional repairs are needed beyond this estimate, we will contact
            you for authorization before proceeding with any extra work.
          </Text>
          <Text style={styles.termsText}>
            4. Replaced Parts: You may request return of replaced parts at the time of
            authorization.
          </Text>
          <Text style={styles.termsText}>
            5. No-Show Fee: A $75 fee will be charged if you are not available at the scheduled time
            and location without prior notice.
          </Text>
          <Text style={styles.termsText}>
            6. Cancellation: Cancellations made less than 24 hours before the scheduled appointment
            are subject to a $50 cancellation fee.
          </Text>
          <Text style={styles.termsText}>
            7. After-Hours Surcharge: Services performed outside standard hours (Mon-Fri 8AM-6PM)
            may include a surcharge of up to $75.
          </Text>
          <Text style={styles.termsText}>
            8. Diagnostic Fee: A diagnostic/trip fee may apply and is non-refundable regardless of
            whether you proceed with repairs.
          </Text>
          <Text style={styles.termsText}>
            9. Payment: Payment is due upon completion of service. We accept cash, card, and digital
            payments. This estimate is valid until {formatDate(estimate.expiresAt)}.
          </Text>
        </View>
        <View style={styles.footer}>
          <Text style={styles.contact}>
            HMLS Mobile Mechanic | Orange County, CA | Mon-Sat 8AM-12AM
          </Text>
        </View>
      </Page>
    </Document>
  );
}
