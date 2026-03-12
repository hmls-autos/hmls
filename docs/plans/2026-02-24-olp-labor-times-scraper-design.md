# OLP Labor Times Scraper

## Goal

Scrape all labor time data from openlaborproject.com and store it in Supabase so the agent can
provide vehicle-specific labor hour estimates instead of generic ones.

## Database Schema

Two tables in existing Supabase project (free tier, ~150 MB estimated):

```sql
olp_vehicles (
  id            serial PK,
  make          varchar(100),   -- "Toyota"
  make_slug     varchar(100),   -- "toyota"
  model         varchar(100),   -- "Camry"
  model_slug    varchar(100),   -- "camry"
  year_range    varchar(20),    -- "2018-2024"
  year_start    int,            -- 2018
  year_end      int,            -- 2024
  engine        varchar(50),    -- "2.5L I4"
  engine_slug   varchar(50),    -- "2.5l-i4"
  fuel_type     varchar(20),    -- "Gas", "Hybrid", "Diesel"
  timing_type   varchar(20),    -- "Chain", "Belt"
  created_at    timestamptz DEFAULT now(),
  UNIQUE(make_slug, model_slug, year_range, engine_slug)
)

olp_labor_times (
  id            serial PK,
  vehicle_id    int FK -> olp_vehicles ON DELETE CASCADE,
  name          varchar(200),   -- "Brake Pads - Front"
  slug          varchar(200),   -- "brake-pads-front"
  category      varchar(50),    -- "brakes"
  labor_hours   numeric(5,2),   -- 0.8
  UNIQUE(vehicle_id, slug)
)

-- Indexes
CREATE INDEX idx_olp_vehicles_lookup ON olp_vehicles(make_slug, model_slug, year_start, year_end);
CREATE INDEX idx_olp_labor_times_vehicle ON olp_labor_times(vehicle_id, category);
```

## Scraper Design

Single Deno script: `apps/api/src/scripts/scrape-olp.ts`

### Crawl Strategy

Hierarchical, 3-level crawl extracting embedded `__NEXT_DATA__` JSON:

1. Fetch `/labor-times` -> extract 87 makes (name, slug, modelCount)
2. For each make -> fetch `/labor-times/{make}/` -> extract models list
3. For each model -> fetch `/labor-times/{make}/{model}/` -> extract vehicle configs (year-range,
   engine, fuel, timing)
4. For each config -> fetch `/labor-times/{make}/{model}/{years}/{engine}/` -> extract
   `jobsByCategory` JSON -> INSERT vehicles + labor times

### Rate Limiting

- 300ms delay between requests (sequential, no parallelism)
- Proper User-Agent header
- ~7,000 total requests, ~35 min runtime

### Resumability

Before fetching a config page, check if `olp_vehicles` already has that (make_slug, model_slug,
year_range, engine_slug). If yes, skip. Allows restart without re-scraping.

### Error Handling

- Retry failed requests up to 3 times with exponential backoff
- Log failures but continue to next item
- Print progress: `[1234/5000] Toyota Camry 2018-2024 2.5L I4 - 530 jobs`

### DB Insertion

- Insert vehicle row first, get ID
- Batch insert labor times in groups of 500
- Use ON CONFLICT DO NOTHING for idempotency

## Deno Task

Add to `apps/api/deno.json`:

```json
"db:scrape-olp": "deno run --env=../../.env --allow-net --allow-env --allow-read src/scripts/scrape-olp.ts"
```

## Scale Estimate

| Item                   | Count  | Size                 |
| ---------------------- | ------ | -------------------- |
| olp_vehicles           | ~5,000 | ~1 MB                |
| olp_labor_times        | ~1.3M  | ~100-150 MB          |
| Current DB             | -      | 13 MB                |
| **Total after scrape** |        | **~165 MB / 500 MB** |

## Example Agent Query

```sql
SELECT lt.name, lt.labor_hours, lt.category
FROM olp_labor_times lt
JOIN olp_vehicles v ON v.id = lt.vehicle_id
WHERE v.make_slug = 'toyota'
  AND v.model_slug = 'camry'
  AND v.year_start <= 2020 AND v.year_end >= 2020
  AND lt.name ILIKE '%brake pad%';
```
