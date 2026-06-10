import { config } from "dotenv";

config({ path: ".env.local" });
config(); // .env fallback; existing vars are never overwritten

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var ${name}. Set it in .env.local or the environment.`);
    process.exit(1);
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  return process.env[name];
}
