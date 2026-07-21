import type { RequestHandler } from "express";

export const GET: RequestHandler = (_req, res) => {
  res.status(200);
  res.send("ok");
};
