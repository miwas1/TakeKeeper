import type { RequestHandler } from "express";
import { db, usersTable } from "@workspace/db";
import { env } from "../config/env";

const developmentUser = {
  id: "dev-user",
  email: "crew@takekeeper.local",
  displayName: "TakeKeeper Crew",
};

export const requireIdentity: RequestHandler = async (_req, res, next) => {
  if (env.NODE_ENV !== "development") {
    res.status(503).json({
      error: "Production authentication provider is not configured",
      code: "AUTH_PROVIDER_REQUIRED",
    });
    return;
  }

  await db
    .insert(usersTable)
    .values(developmentUser)
    .onConflictDoUpdate({
      target: usersTable.id,
      set: { displayName: developmentUser.displayName },
    });

  res.locals.userId = developmentUser.id;
  next();
};