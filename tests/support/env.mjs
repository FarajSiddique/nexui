/** Sets env vars for one test and restores them after; `undefined` deletes one. */
export function useEnv(t, values) {
  const assign = (entries) => {
    for (const [name, value] of Object.entries(entries)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  };
  const previous = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));

  assign(values);
  t.after(() => assign(previous));
}
