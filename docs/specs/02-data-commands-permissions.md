# Data, Commands, and Permissions Spec

## 1. Purpose

This file turns the Discord workflow into concrete persisted data, command surfaces, component IDs, and authorization rules for MVP implementation.

## 2. Technical Assumptions

- Runtime: Node.js
- Language: TypeScript
- Discord library: `discord.js`
- ORM: Prisma
- Database: SQLite for MVP
- Deployment shape: one bot process, one SQLite database file

Implications:
- Discord snowflakes are stored as strings
- claim/status transitions must be handled atomically
- slash commands are used for setup/admin recovery
- buttons/modals are used for the primary contributor workflow

## 3. Domain Model

## 3.1. GuildConfig
Stores per-server configuration.

Suggested fields:
- `id`
- `guildId`
- `dashboardChannelId`
- `dashboardSummaryMessageId`
- `feedChannelId`
- `archiveChannelId` nullable
- `adminRoleId`
- `reviewerRoleId` nullable
- `maxActiveTasksPerUser`
- `defaultThreadAutoArchiveMinutes`
- `createdAt`
- `updatedAt`

## 3.2. Task
Stores the current state of a task.

Suggested fields:
- `id` (internal numeric ID)
- `taskCode` (e.g. `TASK-012`)
- `guildId`
- `title`
- `description`
- `requiredRole`
- `priority`
- `status`
- `createdByDiscordUserId`
- `assigneeDiscordUserId` nullable
- `taskMessageChannelId`
- `taskMessageId`
- `threadChannelId` nullable
- `blockedReason` nullable
- `deadlineAt` nullable
- `reviewRequestedAt` nullable
- `completedAt` nullable
- `createdAt`
- `updatedAt`

## 3.3. TaskStatusHistory
Stores every important transition for auditability.

Suggested fields:
- `id`
- `taskId`
- `actorDiscordUserId`
- `fromStatus` nullable
- `toStatus`
- `reason` nullable
- `createdAt`

## 3.4. Optional TaskEvent table
Optional for MVP if you want richer event logging separate from pure status history.

Potential fields:
- `id`
- `taskId`
- `type`
- `payloadJson`
- `actorDiscordUserId`
- `createdAt`

MVP may skip this if `TaskStatusHistory` is enough.

## 4. Enums and Allowed Values

## 4.1. TaskStatus
- `BACKLOG`
- `IN_PROGRESS`
- `BLOCKED`
- `REVIEW`
- `DONE`

## 4.2. TaskPriority
- `LOW`
- `MEDIUM`
- `HIGH`
- `URGENT`

## 4.3. RequiredRole
- `ADMIN`
- `TECHNICIAN`
- `RESEARCHER`

## 4.4. TaskEventType (if event table is added)
- `CREATED`
- `CLAIMED`
- `BLOCKED`
- `UNBLOCKED`
- `REVIEW_REQUESTED`
- `APPROVED`
- `RETURNED`
- `REOPENED`
- `REASSIGNED`
- `THREAD_CREATED`
- `SYNC_REPAIRED`

## 5. Data Integrity Rules

- A task has at most one current assignee
- A task has at most one active linked thread
- `blockedReason` is required when a task enters `BLOCKED`
- `completedAt` is required when a task enters `DONE`
- `reviewRequestedAt` is set when a task enters `REVIEW`
- `threadChannelId` is created on first successful claim, not before
- A task must exist before a task card is rendered
- `taskMessageId` is required once the dashboard card has been posted

## 6. State Transition Rules

| From | To | Allowed by |
|---|---|---|
| BACKLOG | IN_PROGRESS | valid claimer or admin |
| IN_PROGRESS | BLOCKED | assignee or admin |
| BLOCKED | IN_PROGRESS | assignee or admin |
| IN_PROGRESS | REVIEW | assignee or admin |
| REVIEW | IN_PROGRESS | reviewer or admin |
| REVIEW | DONE | reviewer or admin |
| DONE | BACKLOG | reviewer or admin |

Hard rules:
- claim only succeeds when `status = BACKLOG` and `assigneeDiscordUserId IS NULL`
- a user must satisfy role checks before claim succeeds
- review should not be requested for an unassigned task unless admin override is explicitly allowed

## 7. Concurrency and Recovery Rules

### Claim concurrency
Claim must be atomic.

Expected behavior:
- only one user can win a race to claim the same backlog task
- the losing user receives an ephemeral "already claimed" response

Implementation intent:
- use a Prisma transaction
- condition update against `status = BACKLOG` and `assigneeDiscordUserId = null`

### Discord/UI recovery
If DB state updates but Discord UI refresh fails:
- keep the DB state as source of truth
- record the failure in logs/history
- allow repair with `/task sync-dashboard`

### Missing thread
If task is assigned but thread creation fails:
- task stays assigned
- feed log should indicate recovery is required

## 8. Slash Commands

## 8.1. Setup/Admin commands
### `/setup`
Purpose:
- initialize guild configuration
- set dashboard/feed/archive channels and core roles

### `/task create`
Purpose:
- create a new task in `BACKLOG`

Inputs:
- title
- description
- required role
- priority
- deadline optional

### `/task reassign`
Purpose:
- change current assignee

### `/task reopen`
Purpose:
- move a `DONE` task back to `BACKLOG`

### `/task sync-dashboard`
Purpose:
- repair summary and/or task card state when Discord messages drift

## 8.2. Contributor/helper commands
### `/task list`
Purpose:
- show tasks by filter or assigned user

### `/task view`
Purpose:
- show one task in detail

Optional fallback commands if buttons are unavailable:
- `/task claim`
- `/task block`
- `/task unblock`
- `/task review`

These are not required if buttons are reliable, but they are useful for admin recovery and accessibility.

## 9. Button and Modal IDs

Recommended `customId` format:
- `task:claim:<taskId>`
- `task:block:<taskId>`
- `task:unblock:<taskId>`
- `task:review:<taskId>`
- `task:approve:<taskId>`
- `task:return:<taskId>`
- `task:reopen:<taskId>`
- `task:thread:<taskId>`

Recommended modal IDs:
- `task:block-reason:<taskId>`
- `task:create`
- optional `task:return-note:<taskId>`

## 10. Permission Model

## 10.1. Discord permissions the bot needs
- View Channels
- Send Messages
- Read Message History
- Use Application Commands
- Create Public Threads
- Send Messages in Threads
- Manage Threads
- Embed Links
- Attach Files optional

## 10.2. App-level roles
### Admin
Can:
- run setup
- create tasks
- reassign tasks
- repair dashboard
- approve review
- reopen done tasks
- override task state where necessary

### Reviewer
Can:
- approve review
- request changes
- reopen done tasks

### Contributor (Technician/Researcher)
Can:
- claim tasks that match their role
- block/unblock their own assigned tasks
- request review on their own tasks

## 10.3. Claim role rules
- `TECHNICIAN` tasks: claimable by `Technician` or `Admin`
- `RESEARCHER` tasks: claimable by `Researcher` or `Admin`
- `ADMIN` tasks: claimable by `Admin` only

## 10.4. Active-task limit
Recommended MVP rule:
- each contributor may have at most `2` active tasks
- active = `IN_PROGRESS`, `BLOCKED`, or `REVIEW`

This value should live in `GuildConfig`.

## 11. Audit and Logging Rules

Every important action should produce:
1. a Task row update if state changes
2. a TaskStatusHistory row insert
3. a task card refresh attempt
4. a summary refresh attempt
5. a feed log entry when operationally useful

Minimum actions to audit:
- create
- claim
- block/unblock
- review request
- approve
- return for changes
- reopen
- reassign
- thread create failure
- dashboard repair

## 12. Recommended Prisma Notes

- Store Discord IDs as `String`
- Use `DateTime` timestamps everywhere
- Use an integer PK internally for easier task references in app logic
- Keep `taskCode` unique per guild
- Create indexes for:
  - `guildId + status`
  - `assigneeDiscordUserId + status`
  - `taskCode`

## 13. Verification Checklist

This spec is complete when:
- every task state has valid outgoing transitions
- every button has a permission rule
- every slash command has a purpose and owner
- the required task fields for each state are defined
- race conditions for claim are accounted for
- dashboard repair behavior is defined when Discord state drifts from DB state
