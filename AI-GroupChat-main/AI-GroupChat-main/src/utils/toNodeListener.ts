// src/utils/toNodeListener.ts
import type { Hono } from 'hono';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const toNodeListener = (app: Hono) => {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    const fetchRequest = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: req.headers as any,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? body : null,
    });

    const response = await app.fetch(fetchRequest);

    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    const responseBody = await response.arrayBuffer();
    res.end(Buffer.from(responseBody));
  };
};
