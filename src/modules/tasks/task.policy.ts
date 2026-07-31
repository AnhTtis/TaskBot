import { PermissionFlagsBits, type PermissionsBitField } from 'discord.js';
import type { RequiredRole } from '@prisma/client';

import { hasTaskMember } from './task.members.js';

type InteractionMemberLike = {
  readonly roles?: string[] | { cache?: { has(id: string): boolean; values(): Iterable<{ name: string }> } };
};

type PermissionHolder = {
  readonly member?: InteractionMemberLike | null;
  readonly memberPermissions?: Readonly<PermissionsBitField> | null;
};

type TaskMemberLike = {
  readonly discordUserId: string;
};

type TaskTeamLike = {
  readonly members?: readonly TaskMemberLike[];
  readonly assigneeDiscordUserId: string | null;
};

type ManagerRoleConfig = {
  readonly adminRoleId: string;
  readonly secondaryManagerRoleId?: string | null;
};

type ReviewerRoleConfig = {
  readonly reviewerRoleId?: string | null;
  readonly secondaryReviewerRoleId?: string | null;
};

function hasRoleId(member: InteractionMemberLike | null | undefined, roleId: string): boolean {
  if (!member || typeof member !== 'object') {
    return false;
  }

  const maybeRoles = member as { roles?: string[] | { cache?: { has(id: string): boolean } } };

  if (Array.isArray(maybeRoles.roles)) {
    return maybeRoles.roles.includes(roleId);
  }

  return maybeRoles.roles?.cache?.has(roleId) ?? false;
}

function hasAnyRoleId(member: InteractionMemberLike | null | undefined, roleIds: readonly string[]): boolean {
  return roleIds.some((roleId) => hasRoleId(member, roleId));
}

function hasRoleName(member: InteractionMemberLike | null | undefined, roleName: string): boolean {
  if (!member || typeof member !== 'object') {
    return false;
  }

  const maybeRoles = member as {
    roles?: string[] | { cache?: Map<string, { name: string }> | { values(): Iterable<{ name: string }> } };
  };

  if (Array.isArray(maybeRoles.roles)) {
    return false;
  }

  const values = maybeRoles.roles?.cache?.values?.();
  if (!values) {
    return false;
  }

  for (const role of values) {
    if (role.name.toLowerCase() === roleName.toLowerCase()) {
      return true;
    }
  }

  return false;
}

function getDistinctRoleIds(roleIds: ReadonlyArray<string | null | undefined>): string[] {
  return [...new Set(roleIds.filter((roleId): roleId is string => Boolean(roleId)))];
}

export function getManagerRoleIds(config: ManagerRoleConfig): string[] {
  return getDistinctRoleIds([config.adminRoleId, config.secondaryManagerRoleId]);
}

export function getReviewerRoleIds(config: ReviewerRoleConfig): string[] {
  return getDistinctRoleIds([config.reviewerRoleId, config.secondaryReviewerRoleId]);
}

export function isAdminOverride(options: PermissionHolder & ManagerRoleConfig): boolean {
  return (
    options.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false
  ) || hasAnyRoleId(options.member, getManagerRoleIds(options));
}

export function hasManagementAccess(options: PermissionHolder & ManagerRoleConfig): boolean {
  return isAdminOverride(options);
}

export function canClaimRequiredRole(options: PermissionHolder & ManagerRoleConfig & {
  readonly requiredRole: RequiredRole;
}): boolean {
  if (isAdminOverride(options)) {
    return true;
  }

  switch (options.requiredRole) {
    case 'ADMIN':
      return false;
    case 'TECHNICIAN':
      return hasRoleName(options.member, 'Technician');
    case 'RESEARCHER':
      return hasRoleName(options.member, 'Researcher');
  }
}

export function canReviewTask(options: PermissionHolder & ManagerRoleConfig & ReviewerRoleConfig): boolean {
  if (hasManagementAccess(options)) {
    return true;
  }

  const reviewerRoleIds = getReviewerRoleIds(options);
  if (reviewerRoleIds.length === 0) {
    return false;
  }

  return hasAnyRoleId(options.member, reviewerRoleIds);
}

export function canManageTaskProgress(options: PermissionHolder & ManagerRoleConfig & {
  readonly task: TaskTeamLike;
  readonly userId: string;
}): boolean {
  if (hasManagementAccess(options)) {
    return true;
  }

  return hasTaskMember(options.task, options.userId);
}
