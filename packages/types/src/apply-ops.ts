import type { GraphObject, GraphSnapshot, Relationship } from './graph.ts';
import type { ChangesetOp } from './ops.ts';

/** An op that doesn't fit the snapshot, such as updating an object that isn't there. */
export class GraphOpError extends Error {}

// Copies only the keys a patch actually sets.
function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function indexOf(items: readonly { id: string }[], id: string): number {
  const index = items.findIndex((item) => item.id === id);

  if (index < 0) {
    throw new GraphOpError(`Nothing with id ${id} in this intent.`);
  }

  return index;
}

/**
 * Applies ops to a snapshot and returns the new one; the input is not changed. The API uses
 * it to stage a changeset before deriving, and the mobile app for optimistic updates.
 *
 * @example
 * applyOps(snapshot, [{ op: 'delete_object', id, origin: 'direct' }], new Date().toISOString())
 */
export function applyOps(
  snapshot: GraphSnapshot,
  ops: readonly ChangesetOp[],
  now: string,
): GraphSnapshot {
  const objects: GraphObject[] = [...snapshot.objects];
  const relationships: Relationship[] = [...snapshot.relationships];
  let { intent, workspace } = snapshot;

  for (const op of ops) {
    switch (op.op) {
      case 'insert_object': {
        if (objects.some((object) => object.id === op.id)) {
          throw new GraphOpError(`Object ${op.id} already exists.`);
        }

        objects.push({
          id: op.id,
          intentId: intent.id,
          kind: op.kind,
          kindVersion: op.kindVersion,
          title: op.title,
          status: op.status,
          data: op.data,
          source: op.source,
          position: op.position,
          createdAt: now,
          updatedAt: now,
        });
        break;
      }

      case 'update_object': {
        const index = indexOf(objects, op.id);

        objects[index] = { ...objects[index]!, ...defined(op.patch), updatedAt: now };
        break;
      }

      case 'delete_object':
        objects.splice(indexOf(objects, op.id), 1);
        break;
      case 'insert_relationship': {
        if (relationships.some((edge) => edge.id === op.id)) {
          throw new GraphOpError(`Relationship ${op.id} already exists.`);
        }

        relationships.push({
          id: op.id,
          intentId: intent.id,
          sourceType: op.sourceType,
          sourceId: op.sourceId,
          targetType: op.targetType,
          targetId: op.targetId,
          type: op.type,
          metadata: op.metadata,
          createdAt: now,
        });
        break;
      }

      case 'delete_relationship':
        relationships.splice(indexOf(relationships, op.id), 1);
        break;
      case 'set_workspace':
        workspace = {
          intentId: intent.id,
          version: (workspace?.version ?? 0) + 1,
          doc: op.doc,
          updatedAt: now,
        };
        break;
      case 'update_intent':
        intent = { ...intent, ...defined(op.patch), updatedAt: now };
        break;
    }
  }

  return { intent, workspace, objects, relationships };
}
