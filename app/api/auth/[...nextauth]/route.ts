/**
 * NextAuth route handler — exposes /api/auth/signin, /api/auth/callback/<provider>,
 * /api/auth/signout, /api/auth/session, /api/auth/csrf etc.
 *
 * Per Auth.js v5 convention the actual config lives at the project root
 * (auth.ts). This file just re-exports the handlers.
 */

import { handlers } from "@/auth";
export const { GET, POST } = handlers;
