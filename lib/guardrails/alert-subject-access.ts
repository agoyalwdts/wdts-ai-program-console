export type AlertSubjectAccess = {
  hasUserRow: boolean;
  invited: boolean;
  notInvited: boolean;
  consoleBlocked: boolean;
  canBlockConsole: boolean;
  canAllowConsole: boolean;
};

/** Maps dashboard User row state to guardrail row badges and console actions. */
export function resolveAlertSubjectAccess(args: {
  hasUserRow: boolean;
  dashboardRoleId: string | null | undefined;
  disabled: boolean | null | undefined;
  canManageUsers: boolean;
  hasEmail: boolean;
}): AlertSubjectAccess {
  const invited = args.hasUserRow && Boolean(args.dashboardRoleId);
  const disabled = args.disabled === true;
  const notInvited = args.hasUserRow && !invited;
  const consoleBlocked = invited && disabled;

  return {
    hasUserRow: args.hasUserRow,
    invited,
    notInvited,
    consoleBlocked,
    canBlockConsole:
      args.canManageUsers && args.hasEmail && invited && !disabled,
    canAllowConsole: args.canManageUsers && args.hasEmail && invited && disabled,
  };
}
