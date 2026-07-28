-- CreateTable
CREATE TABLE "TaskMember" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "taskId" INTEGER NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskMember_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TaskMember_discordUserId_idx" ON "TaskMember"("discordUserId");

-- CreateIndex
CREATE INDEX "TaskMember_taskId_joinedAt_idx" ON "TaskMember"("taskId", "joinedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskMember_taskId_discordUserId_key" ON "TaskMember"("taskId", "discordUserId");
