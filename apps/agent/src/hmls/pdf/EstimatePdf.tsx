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
    position: "absolute",
    bottom: 40,
    left: 40,
    right: 40,
  },
  disclaimer: {
    fontSize: 9,
    color: "#666666",
    marginBottom: 15,
    padding: 10,
    backgroundColor: "#f9fafb",
    borderRadius: 4,
  },
  cta: {
    fontSize: 10,
    textAlign: "center",
    marginBottom: 15,
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
          <Text style={styles.disclaimer}>
            By proceeding with this estimate, you authorize HMLS Mobile Mechanic to perform the
            services listed above. This estimate is valid until {formatDate(estimate.expiresAt)}.
            Final price may vary based on actual conditions found during service. Payment is due upon
            completion of service.
          </Text>
          <Text style={styles.cta}>
            Ready to proceed? Reply in chat or call us to schedule your service.
          </Text>
          <Text style={styles.contact}>
            HMLS Mobile Mechanic | Orange County, CA | Mon-Sat 8AM-12AM
          </Text>
        </View>
      </Page>
    </Document>
  );
}
