export type UserRole = "user" | "admin";

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
