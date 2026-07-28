# Discord UX & Workflow Spec

## 1. Purpose

TaskBot is a Discord-native task workflow bot for a small team. Its MVP goal is to let team members:

- see tasks in a shared dashboard
- claim a backlog task with one click
- get auto-assigned immediately after claiming
- start work inside an automatically created thread
- move the task through a strict workflow until review and completion

This spec defines the user-facing behavior only.

## 2. MVP Scope

### In scope
- One Discord server per deployment target
- One dashboard channel for task visibility
- Slash commands for setup/admin actions
- Buttons/modals for day-to-day workflow
- One assignee per task
- One work thread per task
- Status flow:
  - `Backlog`
  - `In Progress`
  - `Blocked`
  - `Review`
  - `Done`
- Admin/reviewer approval before final completion

### Out of scope
- Web dashboard
- Multi-assignee tasks
- Subtasks
- Time tracking
- GitHub/Jira sync
- AI-generated summaries
- Cross-server shared workspace

## 3. Discord UX Constraints and Chosen Pattern

Discord does not provide a true Trello-style Kanban board. For MVP, the dashboard will use:

1. **One summary message** in `#task-dashboard`
2. **One task card message per task** in `#task-dashboard`
3. **One public thread per task**, created only when work starts

This pattern keeps the experience Discord-native while still giving:
- a board-like overview
- interactive actions
- a dedicated workspace for each task

## 4. Channels and Roles

### Required channels
- `#task-dashboard`: summary + task cards
- `#task-feed`: audit-style updates and recovery notices
- `#archive`: optional archive/reference channel for closed task logs

### Expected roles
- `Admin`
- `Technician`
- `Researcher`
- optional `Reviewer` role if review is separated from admin

## 5. Visible Objects

### 5.1. Dashboard summary message
A pinned or known bot-authored message showing:
- total tasks by status
- overdue count
- top items needing attention
- last refresh timestamp

Example summary sections:
- Backlog count
- In Progress count
- Blocked count
- Review count
- Done today count

### 5.2. Task card message
Each task card must show:
- Task code, e.g. `TASK-012`
- Title
- Short description
- Required role
- Priority
- Status
- Assignee or `Unassigned`
- Deadline if present
- Block reason if status is `Blocked`
- Thread link if created
- Last updated time

### 5.3. Work thread
A dedicated public thread attached to the task card message.

Purpose:
- day-to-day discussion
- attachments
- progress notes
- blocker discussion
- review discussion

## 6. Status Model

### Statuses
- `Backlog`: created, visible, not yet claimed
- `In Progress`: actively being worked on by exactly one assignee
- `Blocked`: cannot proceed until blocker is removed
- `Review`: work finished by assignee, waiting for admin/reviewer decision
- `Done`: accepted and closed

### Allowed transitions
| From | To | Trigger |
|---|---|---|
| Backlog | In Progress | assignee clicks `Claim` |
| In Progress | Blocked | assignee/admin clicks `Block` |
| Blocked | In Progress | assignee/admin clicks `Unblock` |
| In Progress | Review | assignee/admin clicks `Request Review` |
| Review | In Progress | reviewer/admin clicks `Changes Requested` |
| Review | Done | reviewer/admin clicks `Approve` |
| Done | Backlog | admin/reviewer clicks `Reopen` |

### Locked rules
- Claiming a task always assigns it and moves it to `In Progress`
- `Blocked` always requires a reason
- `Done` cannot be set directly by a normal contributor in MVP

## 7. Primary User Flows

### 7.1. Create task
1. Admin runs `/task create`
2. Bot collects title, description, role, priority, deadline, optional notes
3. Bot creates the task in `Backlog`
4. Bot posts a task card in `#task-dashboard`
5. Bot refreshes the dashboard summary
6. Bot logs the event in `#task-feed`

### 7.2. Claim task
1. A user sees a backlog task card
2. They click `Claim`
3. Bot validates:
   - task is still `Backlog`
   - user has the right role
   - user has not exceeded the active-task limit
4. Bot assigns the user
5. Bot moves task to `In Progress`
6. Bot creates the task thread if one does not exist
7. Bot posts a starter message in the thread
8. Bot refreshes the task card and summary
9. Bot logs the change in `#task-feed`

### 7.3. Block task
1. Assignee clicks `Block`
2. Bot opens a modal for the blocker reason
3. Task moves to `Blocked`
4. Card displays the blocker reason
5. Admin/reviewer is notified if configured

### 7.4. Unblock task
1. Assignee/admin clicks `Unblock`
2. Task returns to `In Progress`
3. Block reason is cleared from current state display
4. Summary and feed refresh

### 7.5. Request review
1. Assignee clicks `Request Review`
2. Task moves to `Review`
3. Reviewer/admin is pinged in thread or dashboard confirmation
4. Card updates to show waiting-for-review state

### 7.6. Approve or return
#### Approve
1. Reviewer/admin clicks `Approve`
2. Task moves to `Done`
3. Thread is archived
4. Card updates to closed state
5. Summary/feed refresh

#### Return for changes
1. Reviewer/admin clicks `Changes Requested`
2. Task moves back to `In Progress`
3. Thread remains open
4. Assignee is notified

### 7.7. Reopen
1. Admin/reviewer clicks `Reopen`
2. Task moves from `Done` to `Backlog`
3. Existing archived thread is preferred for restoration if possible
4. If restoration is not possible, a new thread may be created on next claim

## 8. Task Card Actions by State

| Status | Visible actions |
|---|---|
| Backlog | `Claim`, `View Details` |
| In Progress | `Open Thread`, `Block`, `Request Review` |
| Blocked | `Open Thread`, `Unblock`, `Request Review` |
| Review | `Open Thread`, `Approve`, `Changes Requested` |
| Done | `Open Thread`, `Reopen` |

Notes:
- `Approve`, `Changes Requested`, and `Reopen` are restricted by permissions
- `Open Thread` should be available whenever a thread exists

## 9. Thread Lifecycle

### Creation
- Thread is created on first successful claim
- Thread is not created during task creation

### Naming
Recommended format:
- `task-012-crawl-semantic-scholar`

### Starter message
The first bot message in a new thread should include:
- task code
- title
- assignee
- status
- deadline
- short description
- quick action guidance

### Closing behavior
- `Done` archives the thread
- thread is not deleted in MVP
- reopen prefers the original thread when technically possible

## 10. Notification Rules

### Notify on claim
- optional confirmation to claimer
- no global ping by default

### Notify on blocked
- ping `Admin` or `Reviewer` role if configured

### Notify on review requested
- ping reviewer/admin

### Notify on returned changes
- ping assignee

### Notify on done
- lightweight confirmation in thread and feed

## 11. Error and Edge Cases

### Two users click Claim at once
- first valid claim wins
- second user gets an ephemeral failure message

### Thread creation fails after claim
- task remains assigned and `In Progress`
- bot logs the failure to `#task-feed`
- admin can repair via sync/retry action later

### Dashboard message missing
- bot logs the issue
- admin uses `/task sync-dashboard`

### Thread was manually deleted or archived incorrectly
- bot should show that the thread is unavailable
- a repair/recreate path must exist in admin tooling

### User lacks role for task
- claim is rejected with an ephemeral explanation

## 12. Acceptance Criteria

The UX spec is satisfied when:
- a task can be created into `Backlog`
- a valid user can claim it with one click
- claim creates exactly one assignee and one work thread
- blocked tasks always show a blocker reason
- review requires reviewer/admin action to complete
- done tasks archive their thread
- summary and card refresh after every state change
