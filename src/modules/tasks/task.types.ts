import type { Prisma, RequiredRole, TaskPriority, TaskStatus } from '@prisma/client';

export type CreateTaskInput = {
  readonly guildId: string;
  readonly taskCode: string;
  readonly title: string;
  readonly description: string;
  readonly requiredRole: RequiredRole;
  readonly priority?: TaskPriority;
  readonly createdByDiscordUserId: string;
  readonly deadlineAt?: Date | null;
  readonly targetMemberCount?: number;
};

export type CreateTaskStatusHistoryInput = {
  readonly taskId: number;
  readonly actorDiscordUserId: string;
  readonly fromStatus?: TaskStatus | null;
  readonly toStatus: TaskStatus;
  readonly reason?: string | null;
};

export type DashboardSummaryCounts = {
  backlog: number;
  inProgress: number;
  blocked: number;
  review: number;
  done: number;
};

export const dashboardSummaryTaskSelect = {
  taskCode: true,
  status: true,
  deadlineAt: true,
  targetMemberCount: true,
  assigneeDiscordUserId: true,
  members: {
    select: {
      discordUserId: true,
    },
    orderBy: {
      joinedAt: 'asc',
    },
  },
} satisfies Prisma.TaskSelect;

export type DashboardSummaryTask = Prisma.TaskGetPayload<{
  select: typeof dashboardSummaryTaskSelect;
}>;

export const taskWithMembersInclude = {
  members: {
    orderBy: {
      joinedAt: 'asc',
    },
  },
} satisfies Prisma.TaskInclude;

export type TaskWithMembers = Prisma.TaskGetPayload<{
  include: typeof taskWithMembersInclude;
}>;

export type AddTaskMemberResult =
  | { readonly status: 'joined'; readonly task: TaskWithMembers }
  | { readonly status: 'missing' }
  | { readonly status: 'not_joinable'; readonly task: TaskWithMembers }
  | { readonly status: 'already_member'; readonly task: TaskWithMembers }
  | { readonly status: 'full'; readonly task: TaskWithMembers };
