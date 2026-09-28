import { signToken } from './supabase-auth.mjs';

/**
 * A PostgREST stand-in: routes `/rest/v1/rpc/<name>` to `handlers[name](args)` and table reads
 * to `handlers['table:<name>'](url)`. A handler returns a value (sent as JSON) or a Response.
 */
export function postgrest(handlers) {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    const key = rpc ? rpc[1] : `table:${url.pathname.replace('/rest/v1/', '')}`;
    const handler = handlers[key];

    if (!handler) {
      return Response.json({ message: `unexpected ${key}` }, { status: 500 });
    }

    const args = rpc && init?.body ? JSON.parse(init.body) : url;
    const result = await handler(args);

    return result instanceof Response ? result : Response.json(result);
  };
}

/** A PostgREST error body with a SQLSTATE, as supabase-js reads it. */
export function pgError(code, status = 400) {
  return Response.json({ code, message: 'internal detail', details: null, hint: null }, { status });
}

export function authed(url, init = {}) {
  return new Request(url, {
    ...init,
    headers: { Authorization: `Bearer ${signToken()}`, ...(init.headers ?? {}) },
  });
}
