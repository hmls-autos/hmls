import { createDbClient } from "@hmls/shared/db";
import * as schema from "./schema.ts";

export const db = createDbClient(schema);
export { schema };
export type { OrderItem } from "./schema.ts";
