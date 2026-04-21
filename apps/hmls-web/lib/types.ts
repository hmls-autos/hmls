export interface LineItem {
  name: string;
  description: string;
  price: number;
}

export interface ServiceItem {
  name: string;
  partsNeeded: boolean;
  partsNote?: string;
}

export interface OrderItem {
  id: string;
  category: "labor" | "parts" | "fee" | "discount";
  name: string;
  description?: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  laborHours?: number;
  partNumber?: string;
  taxable: boolean;
}

export interface Order {
  id: number;
  customerId: number | null;
  status: string;
  statusHistory: { status: string; timestamp: string; actor: string }[];
  adminNotes: string | null;
  cancellationReason: string | null;
  items: OrderItem[];
  notes: string | null;
  subtotalCents: number;
  priceRangeLowCents: number | null;
  priceRangeHighCents: number | null;
  vehicleInfo: { year?: number; make?: string; model?: string } | null;
  validDays: number;
  expiresAt: string | null;
  shareToken: string | null;
  revisionNumber: number;
  capturedAmountCents: number | null;
  // Payment tracking (manual)
  paidAt: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  // Per-order contact snapshot (prefer these over customer record for display)
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contactAddress: string | null;
  // Scheduling (absorbed from bookings in Layer 3)
  scheduledAt: string | null;
  appointmentEnd: string | null;
  durationMinutes: number | null;
  providerId: number | null;
  location: string | null;
  locationLat: string | null;
  locationLng: string | null;
  accessInstructions: string | null;
  symptomDescription: string | null;
  photoUrls: string[] | null;
  customerNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderEvent {
  id: number;
  orderId: number;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  actor: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface OrderDetail {
  order: Order;
  customer: Customer | null;
  events: OrderEvent[];
}

export interface Customer {
  id: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  vehicleInfo: { make?: string; model?: string; year?: string } | null;
  stripeCustomerId?: string | null;
  role?: string;
  createdAt: string;
}
