-- CreateTable
CREATE TABLE "TaskAttachment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "taskId" INTEGER NOT NULL,
    "label" TEXT,
    "url" TEXT NOT NULL,
    "fileName" TEXT,
    "contentType" TEXT,
    "sizeBytes" INTEGER,
    "addedByDiscordUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskReminderReceipt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "taskId" INTEGER NOT NULL,
    "recipientDiscordUserId" TEXT NOT NULL,
    "reminderKey" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskReminderReceipt_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "taskId" INTEGER NOT NULL,
    "actorDiscordUserId" TEXT,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    "defaultTimezone" TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    "defaultDateInputMode" TEXT NOT NULL DEFAULT 'VIETNAM_OR_ISO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_GuildConfig" ("adminRoleId", "archiveChannelId", "createdAt", "dashboardChannelId", "dashboardSummaryMessageId", "defaultThreadAutoArchiveMinutes", "feedChannelId", "guildId", "id", "maxActiveTasksPerUser", "reviewerRoleId", "secondaryManagerRoleId", "secondaryReviewerRoleId", "updatedAt") SELECT "adminRoleId", "archiveChannelId", "createdAt", "dashboardChannelId", "dashboardSummaryMessageId", "defaultThreadAutoArchiveMinutes", "feedChannelId", "guildId", "id", "maxActiveTasksPerUser", "reviewerRoleId", "secondaryManagerRoleId", "secondaryReviewerRoleId", "updatedAt" FROM "GuildConfig";
DROP TABLE "GuildConfig";
ALTER TABLE "new_GuildConfig" RENAME TO "GuildConfig";
CREATE UNIQUE INDEX "GuildConfig_guildId_key" ON "GuildConfig"("guildId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "TaskAttachment_taskId_createdAt_idx" ON "TaskAttachment"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskReminderReceipt_recipientDiscordUserId_sentAt_idx" ON "TaskReminderReceipt"("recipientDiscordUserId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskReminderReceipt_taskId_recipientDiscordUserId_reminderKey_key" ON "TaskReminderReceipt"("taskId", "recipientDiscordUserId", "reminderKey");

-- CreateIndex
CREATE INDEX "TaskEvent_taskId_createdAt_idx" ON "TaskEvent"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskEvent_type_createdAt_idx" ON "TaskEvent"("type", "createdAt");
