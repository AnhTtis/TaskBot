type TaskMemberLike = {
  readonly discordUserId: string;
};

type TaskTeamLike = {
  readonly assigneeDiscordUserId: string | null;
  readonly targetMemberCount?: number | null;
  readonly members?: readonly TaskMemberLike[];
};

export function getTaskMemberUserIds(task: TaskTeamLike): string[] {
  const memberIds = task.members?.map((member) => member.discordUserId) ?? [];

  if (memberIds.length > 0) {
    return memberIds;
  }

  return task.assigneeDiscordUserId ? [task.assigneeDiscordUserId] : [];
}

export function getTaskMemberCount(task: TaskTeamLike): number {
  return getTaskMemberUserIds(task).length;
}

export function getTaskTargetMemberCount(task: TaskTeamLike): number {
  return Math.max(1, task.targetMemberCount ?? 1);
}

export function getTaskRemainingSlots(task: TaskTeamLike): number {
  return Math.max(0, getTaskTargetMemberCount(task) - getTaskMemberCount(task));
}

export function taskNeedsMoreMembers(task: TaskTeamLike): boolean {
  return getTaskRemainingSlots(task) > 0;
}

export function hasTaskMember(task: TaskTeamLike, discordUserId: string): boolean {
  return getTaskMemberUserIds(task).includes(discordUserId);
}

export function hasTaskTeam(task: TaskTeamLike): boolean {
  return getTaskMemberUserIds(task).length > 0;
}

export function formatTaskTeamMentions(task: TaskTeamLike): string {
  const memberIds = getTaskMemberUserIds(task);

  return memberIds.length > 0
    ? memberIds.map((memberId) => `<@${memberId}>`).join(', ')
    : 'No team yet';
}

export function formatTaskTeamSummary(task: TaskTeamLike): string {
  return `${getTaskMemberCount(task)}/${getTaskTargetMemberCount(task)} • ${formatTaskTeamMentions(task)}`;
}
