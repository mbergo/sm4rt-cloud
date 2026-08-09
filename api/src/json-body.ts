import type { FastifyInstance } from 'fastify';

/**
 * Replace Fastify's default JSON parser with one that tolerates empty bodies.
 * Browsers/clients often send `content-type: application/json` on DELETE with
 * no payload; Fastify's default rejects that with FST_ERR_CTP_EMPTY_JSON_BODY.
 */
export function registerLenientJsonParser(app: FastifyInstance): void {
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (body === '' || body === undefined) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      e.statusCode = 400;
      done(e, undefined);
    }
  });
}
