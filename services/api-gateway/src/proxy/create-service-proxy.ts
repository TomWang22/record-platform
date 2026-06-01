import type { Request } from "express";
import type { ServerResponse as NodeServerResponse } from "http";
import type { Socket } from "net";
import { sendJson502 } from "../middleware/errors.js";

export function proxyOnError(label: string) {
  return {
    error(err: Error, _req: Request, res: NodeServerResponse | Socket) {
      console.error(`[gw] ${label}:`, err.message);
      sendJson502(res, `${label} upstream error`);
    },
  };
}
