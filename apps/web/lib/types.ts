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
  notes: string | null;
  shareToken: string;
  validDays: number;
  expiresAt: string;
  convertedToQuoteId: number | null;
  createdAt: string;
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
  createdAt: string;
  updatedAt: string;
}
