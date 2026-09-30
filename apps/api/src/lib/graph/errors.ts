/** The intent, event or object isn't there, or isn't the caller's. */
export class GraphNotFoundError extends Error {}

/** A changeset the graph rejects. `message` is safe to show the user. */
export class ChangesetInvalidError extends Error {}

/** Something changed underneath the request. `message` is safe to show the user. */
export class ChangesetConflictError extends Error {}

/** A database error the graph doesn't recognise. Keeps only its code, for the log. */
export class GraphDatabaseError extends Error {
  readonly code: string | undefined;

  constructor(code: string | undefined) {
    super('Saving the change failed.');
    this.code = code;
  }
}

/**
 * Maps a Postgres error from the graph functions to one of the errors above. Unknown errors
 * get a generic message; the original is never shown.
 */
export function mapRpcError(error: { code?: string }): Error {
  switch (error.code) {
    case 'NXU04':
      return new GraphNotFoundError('Not found.');
    case 'NXU08':
      return new ChangesetConflictError('This changed while you were editing. Try again.');
    case 'NXU09':
      return new ChangesetConflictError("Something changed since then, so this can't be undone.");
    case 'NXU10':
      return new ChangesetConflictError('That was already undone.');
    case 'NXU11':
      return new ChangesetConflictError('That already exists.');
    case 'NXU12':
      return new ChangesetConflictError('Nexui is still working on this plan.');
    case 'NXU22':
      return new ChangesetInvalidError('That change is not valid.');
    default:
      return new GraphDatabaseError(error.code);
  }
}
