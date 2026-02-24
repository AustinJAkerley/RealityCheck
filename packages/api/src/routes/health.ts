/**
 * GET /health
 *
 * Lightweight liveness probe endpoint.
 * Returns HTTP 200 with a JSON body suitable for Azure App Service / Azure
 * Container Apps health checks.
 */
import { Router, Request, Response } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'reality-check-api' });
});
