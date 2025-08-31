// lib/env.ts
import { z } from "zod";

const EnvSchema = z.object({
  TWITTER_SCANNER_API_URL: z.string().url(),
  TWITTER_SCANNER_SECRET: z.string().min(10),
});

export const env = EnvSchema.parse({
  TWITTER_SCANNER_API_URL: process.env.TWITTER_SCANNER_API_URL,
  TWITTER_SCANNER_SECRET: process.env.TWITTER_SCANNER_SECRET,
});

