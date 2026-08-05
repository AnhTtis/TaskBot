import type {
  Prisma,
  Task,
  TaskAttachment,
  TaskEvent,
  TaskReminderReceipt,
  TaskStatus,
} from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { formatLegacyTaskCode } from './task.helpers.js';
import type {
  AddTaskMemberResult,
  CreateTaskAttachmentInput,
  CreateTaskEventInput,
  CreateTaskInput,
  CreateTaskReminderReceiptInput,
  CreateTaskStatusHistoryInput,
  DashboardSummaryTask,
  TaskWithMembers,
} from './task.types.js';
import { dashboardSummaryTaskSelect, taskWithMembersInclude } from './task.types.js';

export async function createTask(input: CreateTaskInput): Promise<Task> {
  return prisma.$transaction(async (tx) => {
    const guildConfig = await tx.guildConfig.findUnique({
      where: { guildId: input.guildId },
      select: { nextTaskNumber: true },
    });

    if (!guildConfig) {
      throw new Error(`Guild config for ${input.guildId} disappeared before task creation.`);
    }

    const taskNumber = guildConfig.nextTaskNumber;
    await tx.guildConfig.update({
      where: { guildId: input.guildId },
      data: { nextTaskNumber: { increment: 1 } },
    });

    const data: Prisma.TaskUncheckedCreateInput = {
      guildId: input.guildId,
      taskCode: formatLegacyTaskCode(taskNumber),
      taskNumber,
      title: input.title,
      description: input.description,
      requiredRole: input.requiredRole,
      createdByDiscordUserId: input.createdByDiscordUserId,
      deadlineAt: input.deadlineAt ?? null,
      targetMemberCount: input.targetMemberCount ?? 1,
      ...(input.priority ? { priority: input.priority } : {}),
    };

    return tx.task.create({ data });
  });
}

export async function findTaskByIdWithMembers(taskId: number): Promise<TaskWithMembers | null> {
  return prisma.task.findUnique({
    where: { id: taskId },
    include: taskWithMembersInclude,
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

export async function findTaskByNumberWithMembers(
  guildId: string,
  taskNumber: number,
): Promise<TaskWithMembers | null> {
  return prisma.task.findUnique({
    where: {
      guildId_taskNumber: {
        guildId,
        taskNumber,
      },
    },
    include: taskWithMembersInclude,
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

export async function updateTaskAttachment(options: {
  readonly attachmentId: number;
  readonly taskId: number;
  readonly url?: string;
  readonly label?: string | null;
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

    return tx.taskAttachment.update({
      where: { id: attachment.id },
      data: {
        ...(options.url !== undefined ? { url: options.url } : {}),
        ...(options.label !== undefined ? { label: options.label } : {}),
      },
    });
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

export async function hasTaskReminderReceipt(options: {
  readonly taskId: number;
  readonly recipientDiscordUserId: string;
  readonly reminderKey: string;
}): Promise<boolean> {
  const receipt = await prisma.taskReminderReceipt.findUnique({
    where: {
      taskId_recipientDiscordUserId_reminderKey: {
        taskId: options.taskId,
        recipientDiscordUserId: options.recipientDiscordUserId,
        reminderKey: options.reminderKey,
      },
    },
    select: { id: true },
  });

  return Boolean(receipt);
}

export async function claimTask(
  taskId: number,
  assigneeDiscordUserId: string,
): Promise<TaskWithMembers | null> {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({
      where: { id: taskId },
      include: taskWithMembersInclude,
    });

    if (!task || task.status !== 'BACKLOG' || task.assigneeDiscordUserId || task.members.length > 0) {
      return null;
    }

    await tx.task.update({
      where: { id: taskId },
      data: {
        assigneeDiscordUserId,
        status: 'IN_PROGRESS',
      },
    });

    await tx.taskMember.create({
      data: {
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
    const task = await tx.task.findUnique({
      where: { id: taskId },
      include: taskWithMembersInclude,
    });

    if (!task) {
      return { status: 'missing' };
    }

    if (!['IN_PROGRESS', 'BLOCKED'].includes(task.status)) {
      return { status: 'not_joinable', task };
    }

    if (task.members.some((member) => member.discordUserId === discordUserId)) {
      return { status: 'already_member', task };
    }

    if (task.members.length >= task.targetMemberCount) {
      return { status: 'full', task };
    }

    await tx.taskMember.create({
      data: {
        taskId,
        discordUserId,
      },
    });

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

export async function countActiveTasksForAssignee(
  guildId: string,
  discordUserId: string,
): Promise<number> {
  return prisma.task.count({
    where: {
      guildId,
      assigneeDiscordUserId: discordUserId,
      status: {
        in: ['IN_PROGRESS', 'BLOCKED', 'REVIEW'],
      },
    },
  });
}

export async function transitionTaskWithMembers(
  taskId: number,
  allowedStatuses: readonly TaskStatus[],
  data: Prisma.TaskUncheckedUpdateInput,
): Promise<TaskWithMembers | null> {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({
      where: { id: taskId },
      include: taskWithMembersInclude,
    });

    if (!task || !allowedStatuses.includes(task.status)) {
      return null;
    }

    await tx.task.update({
      where: { id: taskId },
      data,
    });

    return tx.task.findUnique({
      where: { id: taskId },
      include: taskWithMembersInclude,
    });
  });
}
