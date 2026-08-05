ALTER TABLE "GuildConfig" ADD COLUMN "nextTaskNumber" INTEGER NOT NULL DEFAULT 1;

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Task" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "taskCode" TEXT NOT NULL,
    "taskNumber" INTEGER NOT NULL,
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

WITH parsed_tasks AS (
    SELECT
        "id",
        "taskCode",
        "guildId",
        "title",
        "description",
        "requiredRole",
        "priority",
        "targetMemberCount",
        "status",
        "createdByDiscordUserId",
        "assigneeDiscordUserId",
        "taskMessageChannelId",
        "taskMessageId",
        "threadChannelId",
        "blockedReason",
        "deadlineAt",
        "reviewRequestedAt",
        "completedAt",
        "createdAt",
        "updatedAt",
        CASE
            WHEN "taskCode" GLOB 'TASK-[0-9]*' AND CAST(SUBSTR("taskCode", 6) AS INTEGER) > 0
            THEN CAST(SUBSTR("taskCode", 6) AS INTEGER)
            ELSE NULL
        END AS "parsedTaskNumber",
        SUM(
            CASE
                WHEN "taskCode" GLOB 'TASK-[0-9]*' AND CAST(SUBSTR("taskCode", 6) AS INTEGER) > 0
                THEN 0
                ELSE 1
            END
        ) OVER (
            PARTITION BY "guildId"
            ORDER BY "createdAt", "id"
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS "fallbackOffset"
    FROM "Task"
),
guild_max AS (
    SELECT
        "guildId",
        COALESCE(MAX("parsedTaskNumber"), 0) AS "maxParsedTaskNumber"
    FROM parsed_tasks
    GROUP BY "guildId"
)
INSERT INTO "new_Task" (
    "id",
    "taskCode",
    "taskNumber",
    "guildId",
    "title",
    "description",
    "requiredRole",
    "priority",
    "targetMemberCount",
    "status",
    "createdByDiscordUserId",
    "assigneeDiscordUserId",
    "taskMessageChannelId",
    "taskMessageId",
    "threadChannelId",
    "blockedReason",
    "deadlineAt",
    "reviewRequestedAt",
    "completedAt",
    "createdAt",
    "updatedAt"
)
SELECT
    parsed_tasks."id",
    parsed_tasks."taskCode",
    COALESCE(parsed_tasks."parsedTaskNumber", guild_max."maxParsedTaskNumber" + parsed_tasks."fallbackOffset") AS "taskNumber",
    parsed_tasks."guildId",
    parsed_tasks."title",
    parsed_tasks."description",
    parsed_tasks."requiredRole",
    parsed_tasks."priority",
    parsed_tasks."targetMemberCount",
    parsed_tasks."status",
    parsed_tasks."createdByDiscordUserId",
    parsed_tasks."assigneeDiscordUserId",
    parsed_tasks."taskMessageChannelId",
    parsed_tasks."taskMessageId",
    parsed_tasks."threadChannelId",
    parsed_tasks."blockedReason",
    parsed_tasks."deadlineAt",
    parsed_tasks."reviewRequestedAt",
    parsed_tasks."completedAt",
    parsed_tasks."createdAt",
    parsed_tasks."updatedAt"
FROM parsed_tasks
JOIN guild_max
  ON guild_max."guildId" = parsed_tasks."guildId";

DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";

CREATE UNIQUE INDEX "Task_guildId_taskCode_key" ON "Task"("guildId", "taskCode");
CREATE UNIQUE INDEX "Task_guildId_taskNumber_key" ON "Task"("guildId", "taskNumber");
CREATE INDEX "Task_guildId_status_idx" ON "Task"("guildId", "status");
CREATE INDEX "Task_assigneeDiscordUserId_status_idx" ON "Task"("assigneeDiscordUserId", "status");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

UPDATE "GuildConfig"
SET "nextTaskNumber" = COALESCE((
    SELECT MAX("taskNumber") + 1
    FROM "Task"
    WHERE "Task"."guildId" = "GuildConfig"."guildId"
), 1);
