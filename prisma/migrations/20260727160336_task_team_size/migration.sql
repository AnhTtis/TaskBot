-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Task" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "taskCode" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requiredRole" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "targetMemberCount" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'BACKLOG',
    "createdByDiscordUserId" TEXT NOT NULL,
    "assigneeDiscordUserId" TEXT,
    "taskMessageChannelId" TEXT,
    "taskMessageId" TEXT,
    "threadChannelId" TEXT,
    "blockedReason" TEXT,
    "deadlineAt" DATETIME,
    "reviewRequestedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig" ("guildId") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("assigneeDiscordUserId", "blockedReason", "completedAt", "createdAt", "createdByDiscordUserId", "deadlineAt", "description", "guildId", "id", "priority", "requiredRole", "reviewRequestedAt", "status", "taskCode", "taskMessageChannelId", "taskMessageId", "threadChannelId", "title", "updatedAt") SELECT "assigneeDiscordUserId", "blockedReason", "completedAt", "createdAt", "createdByDiscordUserId", "deadlineAt", "description", "guildId", "id", "priority", "requiredRole", "reviewRequestedAt", "status", "taskCode", "taskMessageChannelId", "taskMessageId", "threadChannelId", "title", "updatedAt" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_guildId_status_idx" ON "Task"("guildId", "status");
CREATE INDEX "Task_assigneeDiscordUserId_status_idx" ON "Task"("assigneeDiscordUserId", "status");
CREATE UNIQUE INDEX "Task_guildId_taskCode_key" ON "Task"("guildId", "taskCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
