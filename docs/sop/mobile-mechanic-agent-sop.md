# Mobile Mechanic Agent - Standard Operating Procedure

## Overview

The Mobile Mechanic Agent is a customer-facing AI receptionist for HMLS Mobile Mechanic. It helps
customers understand services, get price estimates, receive formal quotes, and book appointments.

## Access Requirements

**Login Required** - Customers must be authenticated to use the chat service. User information is
automatically injected from the session.

## User Flow

```
Login → Chat → [Service Inquiry / Estimate / Quote / Booking]
```

### 1. Service Inquiry

**Trigger:** Customer asks about available services or pricing

**Agent Actions:**

1. Use `get_services` tool to query service catalog
2. Present services with price ranges and descriptions
3. Answer follow-up questions about service details

**Example:**

- Customer: "What services do you offer?"
- Agent: Lists maintenance, repair, and diagnostic services with price ranges

### 2. Estimate Generation

**Trigger:** Customer wants to know the cost for specific work

**Required Information:**

- Vehicle make, model, year (agent asks if not provided)
- Description of services needed

**Agent Actions:**

1. Ask for vehicle information if not already collected
2. Understand the services needed
3. Use `create_estimate` to generate PDF estimate
4. Present download link to customer
5. Offer to send formal quote if customer is satisfied

**Output:**

- Downloadable PDF estimate
- Shareable URL for the estimate
- Price range (accounts for ±10% variance)

### 3. Formal Quote

**Trigger:** Customer wants to proceed after viewing estimate

**Agent Actions:**

1. Confirm customer email
2. Use `create_quote` to send Stripe quote
3. Customer receives email with link to view/accept quote

**Quote Status:**

- draft → sent → accepted/declined/expired
- Agent can check status with `get_quote_status`

### 4. Appointment Booking

**Trigger:** Customer ready to schedule service

**Agent Actions:**

1. Use `get_availability` to check available slots
2. Present options to customer
3. Confirm date, time, and location
4. Use `create_booking` to schedule appointment

## User Context

### Automatic (from session)

| Field       | Source       |
| ----------- | ------------ |
| Name        | User profile |
| Email       | User profile |
| Phone       | User profile |
| Customer ID | Database     |

### Per-Conversation (agent asks)

| Field         | When Needed             |
| ------------- | ----------------------- |
| Vehicle Make  | Before estimate/booking |
| Vehicle Model | Before estimate/booking |
| Vehicle Year  | Before estimate/booking |

**Note:** Vehicle info is NOT stored in profile to support customers with multiple vehicles.

## Technical Integration

### Frontend → Agent

```
POST /task
Headers:
  Content-Type: application/json
  X-User-Context: {"id": 1, "name": "John", "email": "john@example.com", "phone": "555-1234"}

Body: AG-UI message format
```

### User Context Header

The web frontend injects user context via `X-User-Context` header:

```json
{
  "id": 1,
  "name": "John Smith",
  "email": "john@example.com",
  "phone": "555-123-4567"
}
```

The agent appends this to the system prompt as:

```
## Current Customer
- Name: John Smith
- Email: john@example.com
- Phone: 555-123-4567
- Customer ID: 1
```

## Available Tools

| Tool               | Purpose                            |
| ------------------ | ---------------------------------- |
| `get_services`     | Query service catalog with pricing |
| `create_estimate`  | Generate PDF estimate              |
| `get_estimate`     | Retrieve existing estimate         |
| `create_quote`     | Send formal Stripe quote           |
| `get_quote_status` | Check quote status                 |
| `get_availability` | Query available time slots         |
| `create_booking`   | Create appointment                 |

## Pricing Guidelines

### Internal Adjustments (not shared with customers)

- **Vehicle type**: Luxury/European vehicles may cost more
- **Vehicle age**: Older vehicles may need additional work
- **Issue complexity**: Complex issues use higher end of range
- **Rush service**: Same-day service adds fee
- **After-hours**: Evening appointments add fee

**Important:** Agent does NOT explain pricing adjustments to customers. Just provides the final
price range.

## Business Information

| Detail       | Value                      |
| ------------ | -------------------------- |
| Service Area | Orange County, CA          |
| Hours        | Mon-Sat 8:00 AM - 12:00 AM |
| Service Type | Mobile (comes to customer) |

### Cities Served

Irvine, Newport Beach, Anaheim, Santa Ana, Costa Mesa, Fullerton, Huntington Beach, Lake Forest,
Mission Viejo

## Skills Reference

The agent loads workflow instructions from `.skills/` directory:

| Skill      | Purpose                 |
| ---------- | ----------------------- |
| services   | Service catalog lookup  |
| estimate   | PDF estimate generation |
| payments   | Stripe quote handling   |
| scheduling | Appointment booking     |

## Error Handling

### Common Scenarios

| Scenario              | Agent Response                            |
| --------------------- | ----------------------------------------- |
| No vehicle info       | Ask customer for make, model, year        |
| Service not available | Politely explain and suggest alternatives |
| Outside service area  | Explain service area coverage             |
| Quote expired         | Offer to create new quote                 |

## Multilingual Support

Agent responds in customer's language (English, Chinese, Spanish, etc.)

## Troubleshooting

### Known Issues

**Database Query Errors**

If the agent reports database errors when calling tools:

1. Verify PostgreSQL is running: `docker compose up -d postgres`
2. Check database connection: `psql $DATABASE_URL -c "SELECT 1"`
3. Ensure tables are seeded: Check that `services` table has data

**Tool Definition Format**

All tools must use consistent format with `schema` (not `parameters`) for Zod validation:

```typescript
export const myTool = {
  name: "my_tool",
  description: "...",
  schema: z.object({ ... }),  // Use 'schema', not 'parameters'
  execute: async (params, _ctx) => { ... }
};
```

**Missing Environment Variables**

Required environment variables:

- `DATABASE_URL`
- `ANTHROPIC_API_KEY`
- `STRIPE_SECRET_KEY`

### Testing the Agent

```bash
# Health check
curl http://localhost:8080/health

# Test chat (requires AG-UI format)
curl -X POST http://localhost:8080/task \
  -H "Content-Type: application/json" \
  -H "X-User-Context: {\"id\":1,\"name\":\"Test\",\"email\":\"test@example.com\",\"phone\":\"555-1234\"}" \
  -d '{
    "threadId": "test-1",
    "runId": "run-1",
    "messages": [{"id": "m1", "role": "user", "content": "What services do you offer?"}],
    "tools": [],
    "context": []
  }'
```
