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

export function isAdminOverride(options: PermissionHolder & { readonly adminRoleId: string }): boolean {
  return (
    options.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false
  ) || hasRoleId(options.member, options.adminRoleId);
}

export function hasManagementAccess(options: PermissionHolder & { readonly adminRoleId: string }): boolean {
  return isAdminOverride(options) || hasRoleName(options.member, 'Technician');
}

export function canClaimRequiredRole(options: PermissionHolder & {
  readonly adminRoleId: string;
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

export function canReviewTask(options: PermissionHolder & {
  readonly adminRoleId: string;
  readonly reviewerRoleId: string | null;
}): boolean {
  if (hasManagementAccess(options)) {
    return true;
  }

  if (!options.reviewerRoleId) {
    return false;
  }

  return hasRoleId(options.member, options.reviewerRoleId);
}

export function canManageTaskProgress(options: PermissionHolder & {
  readonly adminRoleId: string;
  readonly task: TaskTeamLike;
  readonly userId: string;
}): boolean {
  if (hasManagementAccess(options)) {
    return true;
  }

  return hasTaskMember(options.task, options.userId);
}
