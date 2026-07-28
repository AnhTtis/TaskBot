import 'dotenv/config';

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DISCORD_TOKEN: z.string().trim().min(1).optional(),
  CLIENT_ID: z.string().trim().min(1).optional(),
  DATABASE_URL: z.string().trim().min(1).default('file:./dev.db'),
  GUILD_ID: z.string().trim().min(1).optional(),
});

const parsedEnv = envSchema.parse(process.env);

export const env = {
  nodeEnv: parsedEnv.NODE_ENV,
  discordToken: parsedEnv.DISCORD_TOKEN ?? null,
  clientId: parsedEnv.CLIENT_ID ?? null,
  databaseUrl: parsedEnv.DATABASE_URL,
  guildId: parsedEnv.GUILD_ID ?? null,
} as const;

export type AppEnv = typeof env;

export function requireDiscordCredentials(): {
  readonly discordToken: string;
  readonly clientId: string;
  readonly guildId: string | null;
} {
  if (!env.discordToken) {
    throw new Error('Missing DISCORD_TOKEN. Set it in your environment or .env file.');
  }

  if (!env.clientId) {
    throw new Error('Missing CLIENT_ID. Set it in your environment or .env file.');
  }

  return {
    discordToken: env.discordToken,
    clientId: env.clientId,
    guildId: env.guildId,
  };
}
