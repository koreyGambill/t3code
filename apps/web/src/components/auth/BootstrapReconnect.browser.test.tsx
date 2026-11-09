import { Atom, AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";
import { RegistryContext } from "@effect/atom-react";
import { BootstrapReconnect } from "./BootstrapReconnect";

it("shows reconnecting and retries once per established session without a click", async () => {
  const registry = AtomRegistry.make();
  using _registry = { [Symbol.dispose]: () => registry.dispose() };
  const generationAtom = Atom.make(0);
  const retry = vi.fn();
  await using screen = await render(
    <RegistryContext.Provider value={registry}>
      <BootstrapReconnect generationAtom={generationAtom} onReconnect={retry} />
    </RegistryContext.Provider>,
  );
  await expect
    .element(screen.getByRole("heading", { name: "Reconnecting to environment" }))
    .toBeVisible();
  expect(retry).not.toHaveBeenCalled();
  registry.set(generationAtom, 1);
  await vi.waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
  await screen.rerender(
    <RegistryContext.Provider value={registry}>
      <BootstrapReconnect generationAtom={generationAtom} onReconnect={retry} />
    </RegistryContext.Provider>,
  );
  expect(retry).toHaveBeenCalledTimes(1);
  registry.set(generationAtom, 2);
  await vi.waitFor(() => expect(retry).toHaveBeenCalledTimes(2));
});
