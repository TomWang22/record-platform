import type { Request } from "express";

export type AuthedRequest = Request & {
  user?: { sub?: string; email?: string; jti?: string };
};
