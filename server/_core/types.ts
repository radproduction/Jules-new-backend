export type UserRole = "user" | "operations_finance" | "admin";

export const USER_ROLES: readonly UserRole[] = ["user", "operations_finance", "admin"] as const;

export type User = {
  id: number;
  email: string;
  name?: string | null;
  role: UserRole;
};

export type SessionPayload = {
  userId: number;
  email: string;
  role: UserRole;
};
