/**
 * Request validation.
 *
 * Usage:
 *   router.post('/', validate({ body: createUserSchema }), asyncHandler(create));
 *
 * The PARSED result replaces req.body / req.query / req.params, so handlers
 * receive coerced, trimmed, whitelisted data - never raw client input. Unknown
 * keys are stripped by Zod objects, which is what stops a client from smuggling
 * `{"role":"admin"}` into an endpoint that never meant to accept it.
 */
import { ApiError } from '../utils/ApiError.js';

const formatIssues = (error) =>
  error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));

export const validate = (schemas) => (req, res, next) => {
  for (const source of ['params', 'query', 'body']) {
    const schema = schemas[source];
    if (!schema) continue;

    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(
        ApiError.validation(
          'The submitted data is invalid',
          formatIssues(result.error),
        ),
      );
    }

    // req.query is a getter on some Express versions; define instead of assign.
    Object.defineProperty(req, source, {
      value: result.data,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }

  return next();
};

export default validate;
