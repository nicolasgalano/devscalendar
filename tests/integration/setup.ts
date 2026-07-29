import path from "node:path";
import { config } from "dotenv";

config({ path: path.resolve(__dirname, "../../.env.local") });

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(
      `Missing ${key}. Integration tests need a running local Supabase ` +
        "(`pnpm exec supabase start`) with `.env.local` populated — see tests/integration/README.md.",
    );
  }
}
