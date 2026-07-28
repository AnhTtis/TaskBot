# MVP Code Plan

## 1. Purpose

This file translates the UX and data specs into a concrete implementation architecture, module layout, and build order for TaskBot.

## 2. Architecture Overview

TaskBot will use a simple layered architecture:

- **Discord layer**: `discord.js` client, commands, buttons, modals, thread operations
- **Service layer**: workflow logic, permission checks, state transition rules
- **Repository layer**: Prisma reads/writes and transactional updates
- **Rendering layer**: summary embeds, task card embeds, action rows
- **Config layer**: guild-specific dashboard/feed/archive settings

Design principles:
- database is the source of truth
- Discord messages are generated views of database state
- service layer owns business rules
- repository layer stays free of Discord-specific formatting

## 3. Target Stack

- Node.js
- TypeScript
- `discord.js`
- Prisma ORM
- SQLite
- environment variables via `.env`

## 4. Proposed Folder Structure

```text
prisma/
  schema.prisma

src/
  index.ts
  config/
    env.ts
    constants.ts
  bot/
    client.ts
    register-commands.ts
    interaction-router.ts
  lib/
    prisma.ts
    logger.ts
    discord.ts
    errors.ts
  modules/
    guild-config/
      guild-config.service.ts
      guild-config.repository.ts
    tasks/
      task.types.ts
      task.repository.ts
      task.policy.ts
      task.service.ts
      task.renderer.ts
      task.commands.ts
      task.interactions.ts
    threads/
      thread.service.ts
```

Optional later additions:
- `jobs/` for reminders and cleanup
- `tests/` for unit/integration coverage

## 5. Module Responsibilities

## 5.1. `src/index.ts`
- boot the process
- load env config
- start Discord client
- initialize Prisma connection

## 5.2. `src/config/env.ts`
- validate required environment variables
- expose typed config to the app

Expected env values later:
- `DISCORD_TOKEN`
- `CLIENT_ID`
- `DATABASE_URL`
- optional `GUILD_ID` for dev registration

## 5.3. `src/bot/client.ts`
- construct Discord client
- choose intents and partials
- register basic lifecycle logging

## 5.4. `src/bot/register-commands.ts`
- define slash commands
- push commands to Discord on deploy/update

## 5.5. `src/bot/interaction-router.ts`
- route chat input commands
- route button interactions
- route modal submissions
- convert unknown/invalid interaction states to user-safe ephemeral messages

## 5.6. `src/lib/prisma.ts`
- create shared Prisma client instance
- centralize lifecycle/shutdown handling

## 5.7. `src/lib/logger.ts`
- provide structured logs for Discord failures, state changes, and repair needs

## 5.8. `src/modules/guild-config/*`
Responsibilities:
- save guild setup data
- load dashboard/feed/archive/role config
- validate whether setup is complete

## 5.9. `src/modules/tasks/task.repository.ts`
Responsibilities:
- create/read/update tasks
- list tasks by status/assignee
- store thread IDs and message IDs
- insert status-history entries
- support transactional claim/update operations

## 5.10. `src/modules/tasks/task.policy.ts`
Responsibilities:
- validate whether a user may claim a task
- validate state transitions
- enforce active-task limits
- enforce role compatibility

## 5.11. `src/modules/tasks/task.service.ts`
Responsibilities:
- orchestrate all task workflow actions
- call repository + thread + renderer helpers
- keep DB and Discord UI in sync as much as possible

Core methods expected:
- `createTask`
- `claimTask`
- `blockTask`
- `unblockTask`
- `requestReview`
- `approveTask`
- `returnTaskToProgress`
- `reopenTask`
- `syncDashboard`

## 5.12. `src/modules/tasks/task.renderer.ts`
Responsibilities:
- build summary embed
- build task card embed
- build action rows based on current task state
- keep visual formatting consistent

## 5.13. `src/modules/tasks/task.commands.ts`
Responsibilities:
- define task slash command handlers
- parse slash-command inputs
- delegate to services

## 5.14. `src/modules/tasks/task.interactions.ts`
Responsibilities:
- handle task button presses and modals
- parse `customId` values
- call correct service method

## 5.15. `src/modules/threads/thread.service.ts`
Responsibilities:
- create task work threads
- post starter messages
- archive/unarchive threads
- detect missing or invalid thread references

## 6. Build Order

## Phase 0 — Project bootstrap
Create the initial runtime and tooling foundation.

Deliverables:
- `package.json`
- `tsconfig.json`
- `.gitignore`
- `.env.example`
- base scripts for dev/build/register commands

Exit criteria:
- project installs
- TypeScript compiles

## Phase 1 — Bot skeleton
Create the minimum Discord app shell.

Deliverables:
- `src/index.ts`
- `src/config/env.ts`
- `src/bot/client.ts`
- `src/bot/register-commands.ts`
- `src/bot/interaction-router.ts`

Exit criteria:
- bot logs in successfully
- a simple test slash command can register/respond

## Phase 2 — Database foundation
Create persistence before task logic.

Deliverables:
- `prisma/schema.prisma`
- first migration
- `src/lib/prisma.ts`
- initial repositories for guild config + tasks

Exit criteria:
- app can read/write to SQLite
- core entities exist in schema

## Phase 3 — Setup flow
Implement initial guild configuration.

Deliverables:
- `/setup`
- `guild-config.service.ts`
- summary dashboard creation logic

Exit criteria:
- admin can set dashboard/feed/archive/roles
- bot stores guild config
- dashboard summary message can be created or refreshed

## Phase 4 — Task creation
Implement backlog task creation and rendering.

Deliverables:
- `/task create`
- `task.renderer.ts`
- task card message posting
- summary refresh after creation

Exit criteria:
- admin can create a task in `Backlog`
- task card appears in dashboard

## Phase 5 — Claim and thread creation
Implement the key MVP interaction.

Deliverables:
- `Claim` button handling
- transactional assign/update logic
- `thread.service.ts`
- starter thread message

Exit criteria:
- valid user can claim a task with one click
- claim assigns exactly one user
- exactly one thread is created for the task

## Phase 6 — Workflow transitions
Implement remaining state changes.

Deliverables:
- `Block` modal and transition
- `Unblock`
- `Request Review`
- `Approve`
- `Changes Requested`
- `Reopen`

Exit criteria:
- all supported state transitions work end-to-end
- task cards and summary refresh each time

## Phase 7 — Recovery and hardening
Add recovery tools and safer failure behavior.

Deliverables:
- `/task sync-dashboard`
- better logging
- stale message/thread recovery strategy

Exit criteria:
- admin can repair Discord UI drift without editing the DB manually

## Phase 8 — Tests and validation
Confirm the implementation can survive typical failures.

Deliverables:
- unit tests for `task.policy.ts`
- service-level tests for transition rules where practical
- manual QA script for Discord flow

Exit criteria:
- concurrency-sensitive claim flow is verified
- invalid transitions are rejected cleanly

## 7. Suggested First End-to-End Milestone

The first milestone that proves the architecture is viable is:
1. `/setup`
2. `/task create`
3. `Claim` button
4. auto-created thread
5. summary + card refresh

If this milestone works, the project foundation is correct enough to add the remaining transitions.

## 8. Error Handling Policy

### User-facing failures
- return ephemeral messages for invalid permissions, invalid state, or already-claimed tasks

### Discord API failures
- log with task ID and guild ID
- keep DB as source of truth
- expose recovery through `/task sync-dashboard`

### DB failures
- fail the interaction without partial UI success
- avoid rendering a task card if the task row is not persisted

### Thread creation failures
- do not duplicate threads
- log the broken state and allow recovery

## 9. Verification Strategy

## 9.1. Spec consistency checks
Before coding heavily, confirm:
- UX states match the DB enums
- buttons map to service methods
- service methods map to repository operations
- permission rules are implemented in one policy layer

## 9.2. Manual acceptance flow
Use this scenario after MVP implementation:
1. Admin runs `/setup`
2. Admin creates a task
3. A valid contributor claims it
4. Bot creates one thread
5. Contributor blocks it with a reason
6. Contributor unblocks it
7. Contributor requests review
8. Reviewer/admin approves it
9. Thread archives and dashboard updates

## 9.3. Failure scenarios to test
- two users click `Claim` at nearly the same time
- thread creation fails after DB claim
- task card message is manually deleted
- reviewer returns task to `In Progress`
- reopened task reuses or safely recreates thread access

## 10. Explicitly Out of Scope for MVP

Do not implement these in the first coding pass:
- subtasks
- multi-assignee tasks
- analytics dashboard
- web UI
- external integrations
- AI summaries
- scheduled daily report automation unless it becomes essential

## 11. Readiness Check

Implementation should begin only after these are true:
- the UX spec, data spec, and code plan all use the same status names
- role rules are settled
- one-task/one-assignee/one-thread MVP scope is accepted
- summary + task-card dashboard model is accepted
- recovery path for UI drift is accepted
