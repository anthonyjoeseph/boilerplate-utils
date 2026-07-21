import type { RequestHandler } from "express";

export const GET: RequestHandler<{ userId: string }> = (req, res) => {
  res.status(200);
  res.send(`user with id: ${req.params.userId}`);
};
