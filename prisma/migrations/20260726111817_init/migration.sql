-- CreateTable
CREATE TABLE "GuildConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "dashboardChannelId" TEXT NOT NULL,
    "dashboardSummaryMessageId" TEXT,
    "feedChannelId" TEXT NOT NULL,
    "archiveChannelId" TEXT,
    "adminRoleId" TEXT NOT NULL,
    "reviewerRoleId" TEXT,
    "maxActiveTasksPerUser" INTEGER NOT NULL DEFAULT 2,
    "defaultThreadAutoArchiveMinutes" INTEGER NOT NULL DEFAULT 1440,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Task" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "taskCode" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requiredRole" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
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

-- CreateTable
CREATE TABLE "TaskStatusHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "taskId" INTEGER NOT NULL,
    "actorDiscordUserId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskStatusHistory_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "GuildConfig_guildId_key" ON "GuildConfig"("guildId");

-- CreateIndex
CREATE INDEX "Task_guildId_status_idx" ON "Task"("guildId", "status");

-- CreateIndex
CREATE INDEX "Task_assigneeDiscordUserId_status_idx" ON "Task"("assigneeDiscordUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Task_guildId_taskCode_key" ON "Task"("guildId", "taskCode");

-- CreateIndex
CREATE INDEX "TaskStatusHistory_taskId_createdAt_idx" ON "TaskStatusHistory"("taskId", "createdAt");
