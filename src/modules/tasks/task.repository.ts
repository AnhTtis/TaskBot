import type {
  Prisma,
  Task,
  TaskAttachment,
  TaskEvent,
  TaskReminderReceipt,
  TaskStatus,
} from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import type {
  AddTaskMemberResult,
  CreateTaskAttachmentInput,
  CreateTaskEventInput,
  CreateTaskInput,
  CreateTaskReminderReceiptInput,
  CreateTaskStatusHistoryInput,
  DashboardSummaryCounts,
  DashboardSummaryTask,
  TaskWithMembers,
} from './task.types.js';
import { dashboardSummaryTaskSelect, taskWithMembersInclude } from './task.types.js';

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const data: Prisma.TaskUncheckedCreateInput = {
    guildId: input.guildId,
    taskCode: input.taskCode,
    title: input.title,
    description: input.description,
    requiredRole: input.requiredRole,
    createdByDiscordUserId: input.createdByDiscordUserId,
    deadlineAt: input.deadlineAt ?? null,
    targetMemberCount: input.targetMemberCount ?? 1,
    ...(input.priority ? { priority: input.priority } : {}),
  };

  return prisma.task.create({ data });
}

export async function findTaskById(taskId: number): Promise<Task | null> {
  return prisma.task.findUnique({
    where: { id: taskId },
  });
}

export async function findTaskByIdWithMembers(taskId: number): Promise<TaskWithMembers | null> {
  return prisma.task.findUnique({
    where: { id: taskId },
    include: taskWithMembersInclude,
  });
}

export async function findTaskByCode(
  guildId: string,
  taskCode: string,
): Promise<Task | null> {
  return prisma.task.findUnique({
    where: {
      guildId_taskCode: {
        guildId,
        taskCode,
      },
    },
  });
}

export async function findTaskByCodeWithMembers(
  guildId: string,
  taskCode: string,
): Promise<TaskWithMembers | null> {
  return prisma.task.findUnique({
    where: {
      guildId_taskCode: {
        guildId,
        taskCode,
      },
    },
    include: taskWithMembersInclude,
  });
}

export async function findLatestTaskForGuild(guildId: string): Promise<Task | null> {
  return prisma.task.findFirst({
    where: { guildId },
    orderBy: { id: 'desc' },
  });
}

export async function listTasksForGuild(guildId: string): Promise<Task[]> {
  return prisma.task.findMany({
    where: { guildId },
    orderBy: {
      createdAt: 'asc',
    },
  });
}

export async function listTasksForGuildWithMembers(guildId: string): Promise<TaskWithMembers[]> {
  return prisma.task.findMany({
    where: { guildId },
    orderBy: {
      createdAt: 'asc',
    },
    include: taskWithMembersInclude,
  });
}

export async function listTasksForDashboardSummary(guildId: string): Promise<DashboardSummaryTask[]> {
  return prisma.task.findMany({
    where: { guildId },
    orderBy: [
      { status: 'asc' },
      { updatedAt: 'desc' },
    ],
    select: dashboardSummaryTaskSelect,
  });
}

export async function listTasksByStatus(
  guildId: string,
  status: TaskStatus,
): Promise<Task[]> {
  return prisma.task.findMany({
    where: {
      guildId,
      status,
    },
    orderBy: {
      createdAt: 'asc',
    },
  });
}

export async function listTasksForDeadlineReminders(options: {
  readonly now: Date;
  readonly dueBefore: Date;
}): Promise<TaskWithMembers[]> {
  return prisma.task.findMany({
    where: {
      status: {
        in: ['IN_PROGRESS', 'BLOCKED', 'REVIEW'],
      },
      deadlineAt: {
        not: null,
        lte: options.dueBefore,
      },
      assigneeDiscordUserId: {
        not: null,
      },
      completedAt: null,
    },
    orderBy: {
      deadlineAt: 'asc',
    },
    include: taskWithMembersInclude,
  });
}

export async function updateTask(
  taskId: number,
  data: Prisma.TaskUncheckedUpdateInput,
): Promise<Task> {
  return prisma.task.update({
    where: { id: taskId },
    data,
  });
}

export async function updateTaskWithMembers(
  taskId: number,
  data: Prisma.TaskUncheckedUpdateInput,
): Promise<TaskWithMembers> {
  await prisma.task.update({
    where: { id: taskId },
    data,
  });

  const updatedTask = await findTaskByIdWithMembers(taskId);
  if (!updatedTask) {
    throw new Error(`Task ${taskId} disappeared after update.`);
  }

  return updatedTask;
}

export async function createTaskAttachment(
  input: CreateTaskAttachmentInput,
): Promise<TaskAttachment> {
  return prisma.taskAttachment.create({
    data: {
      taskId: input.taskId,
      label: input.label ?? null,
      url: input.url,
      fileName: input.fileName ?? null,
      contentType: input.contentType ?? null,
      sizeBytes: input.sizeBytes ?? null,
      addedByDiscordUserId: input.addedByDiscordUserId,
    },
  });
}

export async function removeTaskAttachment(options: {
  readonly attachmentId: number;
  readonly taskId: number;
}): Promise<TaskAttachment | null> {
  return prisma.$transaction(async (tx) => {
    const attachment = await tx.taskAttachment.findFirst({
      where: {
        id: options.attachmentId,
        taskId: options.taskId,
      },
    });

    if (!attachment) {
      return null;
    }

    await tx.taskAttachment.delete({
      where: { id: attachment.id },
    });

    return attachment;
  });
}

export async function listTaskAttachments(taskId: number): Promise<TaskAttachment[]> {
  return prisma.taskAttachment.findMany({
    where: { taskId },
    orderBy: {
      createdAt: 'asc',
    },
  });
}

export async function createTaskStatusHistory(
  input: CreateTaskStatusHistoryInput,
): Promise<void> {
  await prisma.taskStatusHistory.create({
    data: {
      taskId: input.taskId,
      actorDiscordUserId: input.actorDiscordUserId,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus,
      reason: input.reason ?? null,
    },
  });
}

export async function createTaskEvent(input: CreateTaskEventInput): Promise<TaskEvent> {
  return prisma.taskEvent.create({
    data: {
      taskId: input.taskId,
      actorDiscordUserId: input.actorDiscordUserId ?? null,
      type: input.type,
      summary: input.summary,
      details: input.details ?? null,
    },
  });
}

export async function createTaskReminderReceipt(
  input: CreateTaskReminderReceiptInput,
): Promise<TaskReminderReceipt> {
  return prisma.taskReminderReceipt.create({
    data: {
      taskId: input.taskId,
      recipientDiscordUserId: input.recipientDiscordUserId,
      reminderKey: input.reminderKey,
    },
  });
}

export async function hasTaskReminderReceipt(input: {
  readonly taskId: number;
  readonly recipientDiscordUserId: string;
  readonly reminderKey: string;
}): Promise<boolean> {
  const receipt = await prisma.taskReminderReceipt.findUnique({
    where: {
      taskId_recipientDiscordUserId_reminderKey: {
        taskId: input.taskId,
        recipientDiscordUserId: input.recipientDiscordUserId,
        reminderKey: input.reminderKey,
      },
    },
  });

  return Boolean(receipt);
}

export async function claimTask(
  taskId: number,
  assigneeDiscordUserId: string,
): Promise<TaskWithMembers | null> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.task.updateMany({
      where: {
        id: taskId,
        status: 'BACKLOG',
        assigneeDiscordUserId: null,
      },
      data: {
        status: 'IN_PROGRESS',
        assigneeDiscordUserId,
        blockedReason: null,
        reviewRequestedAt: null,
        completedAt: null,
      },
    });

    if (updated.count === 0) {
      return null;
    }

    await tx.taskMember.upsert({
      where: {
        taskId_discordUserId: {
          taskId,
          discordUserId: assigneeDiscordUserId,
        },
      },
      update: {},
      create: {
        taskId,
        discordUserId: assigneeDiscordUserId,
      },
    });

    return tx.task.findUnique({
      where: { id: taskId },
      include: taskWithMembersInclude,
    });
  });
}

export async function addTaskMember(
  taskId: number,
  discordUserId: string,
): Promise<AddTaskMemberResult> {
  return prisma.$transaction(async (tx) => {
    const existingTask = await tx.task.findUnique({
      where: { id: taskId },
      include: taskWithMembersInclude,
    });

    if (!existingTask) {
      return { status: 'missing' };
    }

    if (!['IN_PROGRESS', 'BLOCKED'].includes(existingTask.status)) {
      return { status: 'not_joinable', task: existingTask };
    }

    if (existingTask.members.some((member) => member.discordUserId === discordUserId)) {
      return { status: 'already_member', task: existingTask };
    }

    if (existingTask.members.length >= existingTask.targetMemberCount) {
      return { status: 'full', task: existingTask };
    }

    await tx.taskMember.create({
      data: {
        taskId,
        discordUserId,
      },
    });

    const memberCount = await tx.taskMember.count({
      where: { taskId },
    });

    if (memberCount > existingTask.targetMemberCount) {
      await tx.taskMember.delete({
        where: {
          taskId_discordUserId: {
            taskId,
            discordUserId,
          },
        },
      });

      const fullTask = await tx.task.findUnique({
        where: { id: taskId },
        include: taskWithMembersInclude,
      });

      if (!fullTask) {
        return { status: 'missing' };
      }

      return { status: 'full', task: fullTask };
    }

    const updatedTask = await tx.task.findUnique({
      where: { id: taskId },
      include: taskWithMembersInclude,
    });

    if (!updatedTask) {
      return { status: 'missing' };
    }

    return { status: 'joined', task: updatedTask };
  });
}

export async function clearTaskMembers(taskId: number): Promise<void> {
  await prisma.taskMember.deleteMany({
    where: { taskId },
  });
}

export async function transitionTask(
  taskId: number,
  allowedStatuses: TaskStatus[],
  data: Prisma.TaskUncheckedUpdateInput,
): Promise<Task | null> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.task.updateMany({
      where: {
        id: taskId,
        status: {
          in: allowedStatuses,
        },
      },
      data,
    });

    if (updated.count === 0) {
      return null;
    }

    return tx.task.findUnique({
      where: { id: taskId },
    });
  });
}

export async function transitionTaskWithMembers(
  taskId: number,
  allowedStatuses: TaskStatus[],
  data: Prisma.TaskUncheckedUpdateInput,
): Promise<TaskWithMembers | null> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.task.updateMany({
      where: {
        id: taskId,
        status: {
          in: allowedStatuses,
        },
      },
      data,
    });

    if (updated.count === 0) {
      return null;
    }

    return tx.task.findUnique({
      where: { id: taskId },
      include: taskWithMembersInclude,
    });
  });
}

export async function countActiveTasksForAssignee(
  guildId: string,
  assigneeDiscordUserId: string,
): Promise<number> {
  return prisma.task.count({
    where: {
      guildId,
      status: {
        in: ['IN_PROGRESS', 'BLOCKED', 'REVIEW'],
      },
      OR: [
        {
          assigneeDiscordUserId,
        },
        {
          members: {
            some: {
              discordUserId: assigneeDiscordUserId,
            },
          },
        },
      ],
    },
  });
}

export async function countTasksByStatus(
  guildId: string,
): Promise<DashboardSummaryCounts> {
  const groupedCounts = await prisma.task.groupBy({
    by: ['status'],
    where: { guildId },
    _count: { _all: true },
  });

  const counts: DashboardSummaryCounts = {
    backlog: 0,
    inProgress: 0,
    blocked: 0,
    review: 0,
    done: 0,
  };

  for (const group of groupedCounts) {
    switch (group.status) {
      case 'BACKLOG':
        counts.backlog = group._count._all;
        break;
      case 'IN_PROGRESS':
        counts.inProgress = group._count._all;
        break;
      case 'BLOCKED':
        counts.blocked = group._count._all;
        break;
      case 'REVIEW':
        counts.review = group._count._all;
        break;
      case 'DONE':
        counts.done = group._count._all;
        break;
    }
  }

  return counts;
}
