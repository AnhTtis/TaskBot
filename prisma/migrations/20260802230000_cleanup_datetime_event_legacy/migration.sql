-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GuildConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "dashboardChannelId" TEXT NOT NULL,
    "dashboardSummaryMessageId" TEXT,
    "feedChannelId" TEXT NOT NULL,
    "archiveChannelId" TEXT,
    "adminRoleId" TEXT NOT NULL,
    "secondaryManagerRoleId" TEXT,
    "reviewerRoleId" TEXT,
    "secondaryReviewerRoleId" TEXT,
    "maxActiveTasksPerUser" INTEGER NOT NULL DEFAULT 2,
    "defaultThreadAutoArchiveMinutes" INTEGER NOT NULL DEFAULT 1440,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_GuildConfig" (
    "adminRoleId",
    "archiveChannelId",
    "createdAt",
    "dashboardChannelId",
    "dashboardSummaryMessageId",
    "defaultThreadAutoArchiveMinutes",
    "feedChannelId",
    "guildId",
    "id",
    "maxActiveTasksPerUser",
    "reviewerRoleId",
    "secondaryManagerRoleId",
    "secondaryReviewerRoleId",
    "updatedAt"
) SELECT
    "adminRoleId",
    "archiveChannelId",
    "createdAt",
    "dashboardChannelId",
    "dashboardSummaryMessageId",
    "defaultThreadAutoArchiveMinutes",
    "feedChannelId",
    "guildId",
    "id",
    "maxActiveTasksPerUser",
    "reviewerRoleId",
    "secondaryManagerRoleId",
    "secondaryReviewerRoleId",
    "updatedAt"
FROM "GuildConfig";
DROP TABLE "GuildConfig";
ALTER TABLE "new_GuildConfig" RENAME TO "GuildConfig";
CREATE UNIQUE INDEX "GuildConfig_guildId_key" ON "GuildConfig"("guildId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
