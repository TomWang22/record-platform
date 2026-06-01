import type { Response, NextFunction } from "express";
import type { AuthedRequest } from "../types.js";

/** Inject x-user-* headers into the outgoing request before proxying. */
export function injectIdentityHeadersIfAny(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction
) {
  delete (req.headers as Record<string, unknown>)["x-user-id"];
  delete (req.headers as Record<string, unknown>)["x-user-email"];
  delete (req.headers as Record<string, unknown>)["x-user-jti"];

  if (req.user?.sub) (req.headers as Record<string, string>)["x-user-id"] = req.user.sub;
  if (req.user?.email) (req.headers as Record<string, string>)["x-user-email"] = req.user.email;
  if (req.user?.jti) (req.headers as Record<string, string>)["x-user-jti"] = req.user.jti;

  next();
}
