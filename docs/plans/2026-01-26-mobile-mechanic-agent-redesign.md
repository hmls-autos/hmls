# Mobile Mechanic Agent Redesign

## Background

The current agent design has audience confusion - it mixes customer-facing and mechanic-facing
functionality. This redesign clarifies the agent's role as a customer-facing receptionist for the
mobile mechanic business.

## Two Separate Products

HMLS has two distinct agent products:

| Product                   | Purpose                                       | Status      |
| ------------------------- | --------------------------------------------- | ----------- |
| **Mobile Mechanic Agent** | Receptionist for the mobile mechanic business | This design |
| **AI Diagnostic Agent**   | Standalone AI car diagnosis product           | Future      |

This document focuses on the Mobile Mechanic Agent.

## Mobile Mechanic Agent

### Role

A website chat receptionist that helps customers:

1. Understand available services
2. Get price estimates
3. Receive formal quotes
4. Book appointments

### Access

**Login required** - Users must be logged in to access the chat service.

### User Flow

```
User logs in → Enters chat → Agent knows user info (name, phone, email)
    │
    ├── Ask about services → Answer questions
    ├── Request estimate → Agent asks for vehicle info → Generate estimate PDF
    ├── Confirm quote → Send Stripe formal quote
    └── Book appointment → Create booking (custom scheduling)
```

### User Context

**From session (automatic):**

- Name
- Email
- Phone
- Customer ID

**Collected per conversation (agent asks):**

- Vehicle make
- Vehicle model
- Vehicle year

This design supports customers with multiple vehicles - each conversation can be about a different
car.

### Tools

**Keep:**

| Tool               | Purpose                                            |
| ------------------ | -------------------------------------------------- |
| `get_services`     | Query available services with pricing and duration |
| `create_estimate`  | Generate estimate PDF                              |
| `create_quote`     | Send formal Stripe quote                           |
| `get_quote_status` | Check quote status                                 |
| `get_availability` | Query available time slots                         |
| `create_booking`   | Create appointment                                 |

**Remove:**

| Tool              | Reason                                      |
| ----------------- | ------------------------------------------- |
| `create_customer` | User registers through auth flow, not agent |
| `get_customer`    | User info injected from session             |
| `create_invoice`  | Owner handles this in backend after service |

### Architecture

```
src/system-prompt.ts     # Simple identity + role + context
.skills/                 # Detailed workflow instructions
├── services/skill.md    # Service catalog lookup
├── estimate/skill.md    # PDF estimate generation
├── payments/skill.md    # Stripe quotes
└── scheduling/skill.md  # Appointment booking
```

### Pricing Guidelines

**Internal adjustments** (not shared with customers):

- Vehicle type (luxury/European may cost more)
- Vehicle age
- Issue complexity

**Important:** Agent should NOT explain pricing adjustments to customers. Just provide the final
price range in a friendly way.

### Implementation Changes

1. **Modify:**
   - `src/tools/customer.ts` - Keep only `get_services`, rename export to `serviceTools`
   - `src/tools/stripe.ts` - Remove `create_invoice` tool
   - `src/agent.ts` - Update tool imports
   - `src/system-prompt.ts` - Simplified receptionist prompt

2. **Add:**
   - Session context injection via `X-User-Context` header
   - Vehicle info collected per-conversation (not stored in profile)

3. **Skills updated:**
   - `services/skill.md` - Replaced `customer/skill.md`
   - `estimate/skill.md` - Removed `get_customer` references
   - `payments/skill.md` - Removed invoice references

## Future: AI Diagnostic Agent

A separate product for intelligent car diagnosis:

- Standalone AI product (potentially mobile app)
- Multi-turn diagnostic conversations
- Multimedia input (photos, audio of car sounds)
- Requires login
- May have separate monetization

This will be designed separately.
