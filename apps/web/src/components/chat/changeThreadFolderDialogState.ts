import type { ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { appAtomRegistry } from "../../rpc/atomRegistry";

export const changeThreadFolderDialogAtom = Atom.make<ScopedThreadRef | null>(null).pipe(
  Atom.keepAlive,
);

export function openChangeThreadFolder(threadRef: ScopedThreadRef) {
  appAtomRegistry.set(changeThreadFolderDialogAtom, threadRef);
}

export function closeChangeThreadFolder() {
  appAtomRegistry.set(changeThreadFolderDialogAtom, null);
}
