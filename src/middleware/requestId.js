/**
 * Attaches a short correlation id to every request.
 *
 * It is echoed in the `X-Request-Id` response header and in error bodies, so a
 * user reporting "I got an error" can hand over an id that appears verbatim in
 * the server logs.
 */
import { randomUUID } from 'node:crypto';

export const requestId = (req, res, next) => {
  const incoming = req.get('X-Request-Id');
  req.id = incoming && incoming.length <= 64 ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};

export default requestId;
