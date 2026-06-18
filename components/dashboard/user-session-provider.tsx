"use client";

import { createContext, useContext } from "react";
import type { SessionUser } from "@/lib/auth";

const UserSessionContext = createContext<SessionUser | null>(null);

export function UserSessionProvider({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  return (
    <UserSessionContext.Provider value={user}>{children}</UserSessionContext.Provider>
  );
}

export function useSessionUser(): SessionUser {
  const user = useContext(UserSessionContext);
  if (!user) {
    throw new Error("useSessionUser must be used within UserSessionProvider");
  }
  return user;
}
