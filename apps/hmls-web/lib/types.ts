export interface LineItem {
  name: string;
  description: string;
  price: number;
}

export interface Booking {
  id: number;
  customerId: number;
  providerId?: number | null;
  serviceType: string;
  serviceItems?: unknown[];
  symptomDescription?: string | null;
  vehicleYear: number | string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleMileage?: number | null;
  estimateId?: number | null;
  scheduledAt: string;
  appointmentEnd?: string | null;
  durationMinutes: number;
  location: string | null;
  customerName?: string | null;
  customerNotes?: string | null;
  internalNotes?: string | null;
  status: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Estimate {
  id: number;
  customerId: number;
  items: LineItem[];
  subtotal: number;
  priceRangeLow: number;
  priceRangeHigh: number;
  vehicleInfo: { year?: number; make?: string; model?: string } | null;
  notes: string | null;
  shareToken: string;
  validDays: number;
  expiresAt: string;
  convertedToQuoteId: number | null;
  createdAt: string;
  orderId?: number | null;
  orderStatus?: string | null;
}

export interface Quote {
  id: number;
  customerId: number;
  bookingId?: number | null;
  stripeQuoteId?: string | null;
  stripeInvoiceId?: string | null;
  items: {
    service?: string;
    name?: string;
    description: string;
    amount?: number;
    price?: number;
  }[];
  totalAmount: number;
  status: string;
  stripePaymentUrl?: string | null;
  expiresAt?: string | null;
  createdAt: string;
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
  customerId: number;
  estimateId: number | null;
  quoteId: number | null;
  bookingId: number | null;
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
  stripeQuoteId: string | null;
  stripeInvoiceId: string | null;
  createdAt: string;
  updatedAt: string;
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
