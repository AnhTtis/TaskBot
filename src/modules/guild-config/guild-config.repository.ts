import type { Prisma, GuildConfig } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';

export async function findGuildConfigByGuildId(
  guildId: string,
): Promise<GuildConfig | null> {
  return prisma.guildConfig.findUnique({
    where: { guildId },
  });
}

export async function upsertGuildConfig(
  guildId: string,
  data: Omit<Prisma.GuildConfigUncheckedCreateInput, 'guildId'>,
): Promise<GuildConfig> {
  return prisma.guildConfig.upsert({
    where: { guildId },
    create: {
      guildId,
      ...data,
    },
    update: data,
  });
}

export async function updateGuildConfig(
  guildId: string,
  data: Prisma.GuildConfigUncheckedUpdateInput,
): Promise<GuildConfig> {
  return prisma.guildConfig.update({
    where: { guildId },
    data,
  });
}
