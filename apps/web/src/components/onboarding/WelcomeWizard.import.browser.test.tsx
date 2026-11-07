import { RegistryContext } from "@effect/atom-react";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthEnvironmentMaintainScope,
  EnvironmentId,
  ProjectId,
  type AgentSessionProjectCandidate,
  type AuthEnvironmentScope,
  type AuthSessionState,
  type DesktopBridge,
  type DesktopWslState,
} from "@t3tools/contracts";
import {
  createHashHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useLocation,
} from "@tanstack/react-router";
import { AsyncResult, Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import { act, render, stubGlobal } from "../../../test/render";

type SessionResult = AsyncResult.AsyncResult<AuthSessionState, Error>;
type Project = { id: ProjectId; environmentId: EnvironmentId; workspaceRoot: string };
type CreateProjectInput = {
  environmentId: EnvironmentId;
  input: { projectId: ProjectId; workspaceRoot: string };
};
const state = vi.hoisted(() => ({
  selectedEnvironment: "primary",
  addedEnvironments: null as unknown,
  sessions: new Map<string, unknown>(),
  projects: null as unknown,
  providers: null as unknown,
  config: null as unknown,
  candidates: [] as AgentSessionProjectCandidate[],
  createProject: vi.fn<(input: CreateProjectInput) => Promise<AsyncResult.Success<void>>>(),
  importThreads: vi.fn(),
  refreshProviders: vi.fn(),
  connectPairing: vi.fn(),
  completeOnboarding: vi.fn(),
  onDone: vi.fn(),
  scan: vi.fn(),
  refreshScan: vi.fn(),
  waitForProject: vi.fn(),
}));

vi.mock(import("@t3tools/client-runtime/state/session"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    createEnvironmentSessionAtoms: ((runtime: never) => ({
      ...actual.createEnvironmentSessionAtoms(runtime),
      sessionStateAtom: (id: EnvironmentId) => state.sessions.get(id),
    })) as never,
  };
});
vi.mock(import("../../cloud/publicConfig"), async (original) => ({
  ...(await original()),
  hasCloudPublicConfig: () => false,
}));
vi.mock(import("../../onboarding/firstRun"), async (original) => ({
  ...(await original()),
  completeOnboarding: state.completeOnboarding,
}));
vi.mock(import("../../state/environments"), async (original) => {
  const { useAtomValue } = await import("@effect/atom-react");
  const environment = (environmentId: string) => ({
    environmentId,
    label: environmentId,
    connection: { phase: "connected" },
    entry: { enabled: true, target: { _tag: "DirectConnectionTarget" } },
  });
  const primary = environment("primary");
  return {
    ...(await original()),
    usePrimaryEnvironment: (() => primary) as never,
    useEnvironments: (() => ({
      environments: [
        state.selectedEnvironment,
        ...useAtomValue(state.addedEnvironments as Atom.Atom<string[]>),
      ].map(environment),
    })) as never,
  };
});
vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      providersValueAtom: (() => state.providers) as never,
      configValueAtom: (() => state.config) as never,
      refreshProviders: "refreshProviders" as never,
    },
  };
});
vi.mock(import("../../state/entities"), async (original) => {
  const { useAtomValue } = await import("@effect/atom-react");
  return {
    ...(await original()),
    useProjects: (() => useAtomValue(state.projects as Atom.Atom<Project[]>)) as never,
    readProjects: (() => appAtomRegistry.get(state.projects as Atom.Atom<Project[]>)) as never,
    waitForProject: ((ref: unknown) => state.waitForProject(ref)) as never,
  };
});
vi.mock(import("../../state/projects"), async (original) => ({
  ...(await original()),
  projectEnvironment: { create: "createProject" } as never,
}));
vi.mock(import("../../state/agentSessions"), async (original) => ({
  ...(await original()),
  agentSessionImport: "importThreads" as never,
}));
vi.mock(import("../../onboarding/useProjectScans"), async (original) => ({
  ...(await original()),
  useProjectScans: (ids: readonly EnvironmentId[]) =>
    ids.map((environmentId) => {
      state.scan({ environmentId });
      return {
        environmentId,
        data: { candidates: state.candidates, truncated: false } as never,
        isPending: false,
        error: null,
        refresh: state.refreshScan,
      };
    }),
}));
vi.mock(import("../../connection/onboarding"), async (original) => ({
  ...(await original()),
  connectPairing: "connectPairing" as never,
}));
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: ((
    command: "createProject" | "importThreads" | "refreshProviders" | "connectPairing",
  ) => state[command]) as never,
}));
vi.mock(import("../settings/ChatGptWelcomeCoordinator"), async (original) => ({
  ...(await original()),
  ChatGptWelcomeCoordinator: () => <></>,
}));
vi.mock(import("../settings/SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useSettingsScope: (() => ({
    search: {},
    scope: { kind: "all" },
    groups: [],
    selectScope: () => undefined,
  })) as never,
}));

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { refreshDesktopWslState } from "../../state/desktopWslState";
import { ProjectsSettings } from "../settings/ProjectsSettings";
import { WelcomeWizard } from "./WelcomeWizard";

const primaryId = EnvironmentId.make("primary");
const remoteId = EnvironmentId.make("remote");
const wslId = EnvironmentId.make("wsl");
const permissionMessage = "This connection cannot import projects or thread history.";

function session(scopes: ReadonlyArray<AuthEnvironmentScope>): AuthSessionState {
  return {
    authenticated: true,
    scopes: [AuthOrchestrationReadScope, ...scopes],
    auth: {
      policy: "remote-reachable",
      bootstrapMethods: ["one-time-token"],
      sessionMethods: ["bearer-access-token"],
      sessionCookieName: "t3_session",
    },
  };
}

function sessionAtom(environmentId: EnvironmentId) {
  return state.sessions.get(environmentId) as Atom.Writable<SessionResult>;
}

function projectsAtom() {
  return state.projects as Atom.Writable<ReadonlyArray<Project>>;
}

function setGrant(environmentId: EnvironmentId, allowed: boolean) {
  appAtomRegistry.set(
    sessionAtom(environmentId),
    AsyncResult.success(session(allowed ? [AuthOrchestrationOperateScope] : [])),
  );
}

// Default selection only picks recently active projects, so pin "now".
const NOW = Date.parse("2026-01-01T00:00:00.000Z");

function candidate(path: string): AgentSessionProjectCandidate {
  return {
    path,
    title: path.split("/").at(-1)!,
    sources: ["codex"],
    threadCount: 10,
    lastActiveAt: new Date(NOW - 60_000).toISOString(),
    alreadyImported: false,
  };
}

function recordProject({ environmentId, input }: CreateProjectInput) {
  appAtomRegistry.set(projectsAtom(), [
    ...appAtomRegistry.get(projectsAtom()),
    { id: input.projectId, environmentId, workspaceRoot: input.workspaceRoot },
  ]);
  return AsyncResult.success(undefined);
}

// Resolves once the project reaches the mocked projects atom; the real helper's timeout is
// replaced per test with a rejection.
function waitForRecordedProject(ref: { environmentId: EnvironmentId; projectId: string }) {
  const find = () =>
    appAtomRegistry
      .get(projectsAtom())
      .find(
        (project) => project.id === ref.projectId && project.environmentId === ref.environmentId,
      );
  return new Promise<Project>((resolve) => {
    const current = find();
    if (current) return resolve(current);
    const unsubscribe = appAtomRegistry.subscribe(projectsAtom(), () => {
      const project = find();
      if (!project) return;
      unsubscribe();
      resolve(project);
    });
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function pageText() {
  return document.body.textContent ?? "";
}

function button(label: string) {
  const found = [...document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

async function click(label: string) {
  const target = button(label);
  expect(target.disabled).toBe(false);
  await act(async () => target.click());
}

async function clickStage(label: string) {
  const stage = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(stage?.disabled).toBe(false);
  await act(async () => stage?.click());
}

async function mountImport(remote = false) {
  state.selectedEnvironment = remote ? "remote" : "primary";
  await using stack = new AsyncDisposableStack();
  const screen = stack.use(
    await render(
      <RegistryContext.Provider value={appAtomRegistry}>
        <WelcomeWizard localAvailable={!remote} onDone={state.onDone} />
      </RegistryContext.Provider>,
    ),
  );
  await click("Continue");
  await click("Continue");
  expect(pageText()).toContain("Import your projects");
  stack.move();
  return screen;
}

// The mocked modules read `state`, so every test starts by replacing all of it.
// Returns the clock spy so each test can `using` it; the spy would otherwise outlive the test.
function setup() {
  const now = vi.spyOn(Date, "now").mockReturnValue(NOW);
  state.selectedEnvironment = "primary";
  state.addedEnvironments = Atom.make<string[]>([]).pipe(Atom.keepAlive);
  state.sessions.clear();
  for (const id of [primaryId, remoteId, wslId]) {
    state.sessions.set(
      id,
      Atom.make<SessionResult>(AsyncResult.success(session([AuthOrchestrationOperateScope]))).pipe(
        Atom.keepAlive,
      ),
    );
  }
  state.projects = Atom.make<ReadonlyArray<Project>>([]).pipe(Atom.keepAlive);
  state.providers = Atom.make<ReadonlyArray<never>>([]).pipe(Atom.keepAlive);
  state.config = Atom.make(null).pipe(Atom.keepAlive);
  state.candidates = [candidate("/projects/first"), candidate("/projects/second")];
  state.createProject
    .mockReset()
    .mockImplementation(async (input: CreateProjectInput) => recordProject(input));
  state.importThreads
    .mockReset()
    .mockResolvedValue(AsyncResult.success({ importedCount: 1, skippedCount: 0 }));
  state.refreshProviders.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.connectPairing.mockReset().mockResolvedValue(AsyncResult.success(remoteId));
  state.completeOnboarding.mockReset().mockResolvedValue(undefined);
  state.onDone.mockReset();
  state.scan.mockReset();
  state.refreshScan.mockReset();
  state.waitForProject.mockReset().mockImplementation(waitForRecordedProject);
  return now;
}

function wslBridge(initial: Partial<DesktopWslState> = {}) {
  let current: DesktopWslState = {
    available: true,
    enabled: false,
    wslOnly: false,
    distro: null,
    distros: [{ name: "Ubuntu", isDefault: true, version: 2 }],
    preflightError: null,
    ...initial,
  };
  const bridge = {
    getClientPlatform: () => "win32",
    getLocalEnvironmentEnabled: () => true,
    getWslState: vi.fn(async () => current),
    setWslOnly: vi.fn(async (wslOnly: boolean) => (current = { ...current, wslOnly })),
    setWslDistro: vi.fn(async (distro: string | null) => (current = { ...current, distro })),
    setWslBackendEnabled: vi.fn(async (enabled: boolean) => {
      appAtomRegistry.set(state.addedEnvironments as Atom.Writable<string[]>, ["wsl"]);
      return (current = { ...current, enabled });
    }),
  };
  return bridge;
}

it.each(["web", "desktop"] as const)(
  "reopens project import from Settings with an existing %s workspace",
  async (surface) => {
    using _now = setup();
    appAtomRegistry.set(projectsAtom(), [
      {
        id: ProjectId.make("existing"),
        environmentId: primaryId,
        workspaceRoot: "/projects/first",
      },
    ]);
    function SettingsOrSetup() {
      const path = useLocation({ select: (location) => location.pathname });
      return path === "/welcome" ? (
        <WelcomeWizard localAvailable onDone={state.onDone} />
      ) : (
        <ProjectsSettings />
      );
    }
    const originalUrl = window.location.href;
    const originalState = window.history.state;
    const history = surface === "desktop" ? createHashHistory() : createMemoryHistory();
    using _history = {
      [Symbol.dispose]() {
        history.destroy();
        window.history.replaceState(originalState, "", originalUrl);
      },
    };
    history.replace("/settings/projects");
    const root = createRootRoute({ component: SettingsOrSetup });
    const router = createRouter({
      history,
      routeTree: root.addChildren([
        createRoute({ getParentRoute: () => root, path: "/settings/projects" }),
        createRoute({ getParentRoute: () => root, path: "/welcome" }),
      ]),
    });
    await router.load();
    // This case exercises the desktop's real hash history as well as browser routing.
    await using _screen = await render(
      <RegistryContext.Provider value={appAtomRegistry}>
        <RouterProvider router={router} />
      </RegistryContext.Provider>,
      { router: false },
    );
    await click("Import conversations and projects");
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/welcome"));
    if (surface === "desktop") expect(window.location.hash).toBe("#/welcome");
    await click("Continue");
    await click("Continue");
    await click("Import 2 projects");
    expect(state.createProject).toHaveBeenCalledOnce();
    expect(state.importThreads).toHaveBeenCalledTimes(2);
    expect(state.onDone).toHaveBeenCalledOnce();
  },
);

it("enables WSL alongside Windows and imports from both environments", async () => {
  using _now = setup();
  appAtomRegistry.set(
    sessionAtom(primaryId),
    AsyncResult.success(session([AuthOrchestrationOperateScope, AuthEnvironmentMaintainScope])),
  );
  const bridge = wslBridge({
    distros: [
      { name: "Ubuntu", isDefault: true, version: 2 },
      { name: "Debian", isDefault: false, version: 2 },
    ],
  });
  const start = deferred<void>();
  const enable = bridge.setWslBackendEnabled.getMockImplementation()!;
  bridge.setWslBackendEnabled.mockImplementationOnce(async (enabled) => {
    await start.promise;
    return enable(enabled);
  });
  using _bridge = stubGlobal("desktopBridge", bridge as unknown as DesktopBridge);
  refreshDesktopWslState();
  await using _screen = await render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <WelcomeWizard localAvailable onDone={state.onDone} />
    </RegistryContext.Provider>,
  );
  await vi.waitFor(() => expect(button("Enable WSL alongside Windows").disabled).toBe(false));
  await page.getByRole("combobox", { name: "WSL distro" }).click();
  await page.getByRole("option", { name: "Debian", exact: true }).click();
  await click("Enable WSL alongside Windows");
  expect(button("Continue").disabled).toBe(true);
  await act(async () => {
    start.resolve();
    await start.promise;
  });
  await vi.waitFor(() => expect(button("Continue").disabled).toBe(false));
  await click("Continue");
  await click("Continue");
  await click("Import 4 projects");
  expect(state.createProject.mock.calls.map(([call]) => call.environmentId)).toEqual([
    primaryId,
    primaryId,
    wslId,
    wslId,
  ]);
  expect(bridge.setWslOnly).toHaveBeenCalledWith(false);
  expect(bridge.setWslDistro).toHaveBeenCalledWith("Debian");
  expect(state.onDone).toHaveBeenCalledOnce();
});

it("keeps Windows setup usable after WSL enable fails and allows retry", async () => {
  using _now = setup();
  appAtomRegistry.set(
    sessionAtom(primaryId),
    AsyncResult.success(session([AuthOrchestrationOperateScope, AuthEnvironmentMaintainScope])),
  );
  const bridge = wslBridge();
  bridge.setWslBackendEnabled.mockRejectedValueOnce(new Error("WSL could not start"));
  using _bridge = stubGlobal("desktopBridge", bridge as unknown as DesktopBridge);
  refreshDesktopWslState();
  await using _screen = await render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <WelcomeWizard localAvailable onDone={state.onDone} />
    </RegistryContext.Provider>,
  );
  await vi.waitFor(() => expect(button("Enable WSL alongside Windows").disabled).toBe(false));
  await click("Enable WSL alongside Windows");
  await vi.waitFor(() => expect(pageText()).toContain("WSL could not start"));
  expect(button("Continue").disabled).toBe(false);
  await click("Enable WSL alongside Windows");
  await vi.waitFor(() => expect(bridge.setWslBackendEnabled).toHaveBeenCalledTimes(2));
  await click("Continue");
  await click("Continue");
  expect(state.scan.mock.calls.map(([call]) => call.environmentId)).toContain(wslId);
});

it.each([
  { enabled: true, wslOnly: false },
  { enabled: true, wslOnly: true },
  { enabled: false, wslOnly: true },
])("preserves existing WSL configuration: %j", async (configuration) => {
  using _now = setup();
  appAtomRegistry.set(
    sessionAtom(primaryId),
    AsyncResult.success(session([AuthOrchestrationOperateScope, AuthEnvironmentMaintainScope])),
  );
  const bridge = wslBridge({ ...configuration, distro: "Ubuntu" });
  using _bridge = stubGlobal("desktopBridge", bridge as unknown as DesktopBridge);
  refreshDesktopWslState();
  await using _screen = await render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <WelcomeWizard localAvailable onDone={state.onDone} />
    </RegistryContext.Provider>,
  );
  await vi.waitFor(() => expect(button("Manage WSL").disabled).toBe(false));
  await click("Continue");
  await click("Continue");
  expect(bridge.setWslOnly).not.toHaveBeenCalled();
  expect(bridge.setWslDistro).not.toHaveBeenCalled();
  expect(bridge.setWslBackendEnabled).not.toHaveBeenCalled();
});

it("sets up a remote environment without probing WSL when local environments are off", async () => {
  using _now = setup();
  state.selectedEnvironment = "remote";
  appAtomRegistry.set(
    sessionAtom(primaryId),
    AsyncResult.success(session([AuthOrchestrationOperateScope, AuthEnvironmentMaintainScope])),
  );
  const bridge = { ...wslBridge(), getLocalEnvironmentEnabled: () => false };
  using _bridge = stubGlobal("desktopBridge", bridge as unknown as DesktopBridge);
  await using _screen = await render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <WelcomeWizard localAvailable={false} onDone={state.onDone} />
    </RegistryContext.Provider>,
  );
  await click("Continue");
  await click("Continue");
  expect(state.scan.mock.calls.map(([call]) => call.environmentId)).toEqual([remoteId]);
  expect(bridge.getWslState).not.toHaveBeenCalled();
  expect(bridge.setWslBackendEnabled).not.toHaveBeenCalled();
});

it("keeps the project selection after going back a stage", async () => {
  using _now = setup();
  await using _screen = await mountImport();
  await click("Select none");
  expect(pageText()).toContain("0 of 2 selected");

  await clickStage("Agents, step 2");
  await click("Continue");
  expect(pageText()).toContain("Import your projects");
  expect(pageText()).toContain("0 of 2 selected");
});

it("ticks the recent projects of a computer added after the selection changed", async () => {
  using _now = setup();
  await using _screen = await mountImport();
  await click("Select none");

  appAtomRegistry.set(state.addedEnvironments as Atom.Writable<string[]>, ["remote"]);
  await clickStage("Connect, step 1");
  await click("Continue");
  await click("Continue");
  expect(pageText()).toContain("2 of 4 selected");

  await click("Import 2 projects");
  const created = state.createProject.mock.calls;
  expect(created.map(([call]) => call.environmentId)).toEqual([remoteId, remoteId]);
});

it("rechecks after project creation and can retry its history without recreating the project", async () => {
  using _now = setup();
  const creation = deferred<void>();
  state.createProject.mockImplementationOnce(async (input: CreateProjectInput) => {
    await creation.promise;
    return recordProject(input);
  });
  await using _screen = await mountImport();
  await click("Import 2 projects");
  expect(state.createProject).toHaveBeenCalledOnce();
  await act(async () => {
    setGrant(primaryId, false);
    creation.resolve();
    await creation.promise;
  });
  expect(state.importThreads).not.toHaveBeenCalled();
  expect(state.createProject).toHaveBeenCalledOnce();
  expect(state.onDone).not.toHaveBeenCalled();
  expect(pageText()).toContain(permissionMessage);

  await act(async () => setGrant(primaryId, true));
  await click("Import 2 projects");
  expect(state.createProject).toHaveBeenCalledTimes(2);
  expect(state.importThreads).toHaveBeenCalledTimes(2);
  expect(state.onDone).toHaveBeenCalledOnce();
});

it("completes accepted imports when permission is revoked after the final server write", async () => {
  using _now = setup();
  state.candidates = state.candidates.slice(0, 1);
  const imported = deferred<{ importedCount: number; skippedCount: number }>();
  state.importThreads.mockImplementationOnce(async () =>
    AsyncResult.success(await imported.promise),
  );
  await using _screen = await mountImport();
  await click("Import 1 project");
  await act(async () => {
    setGrant(primaryId, false);
    imported.resolve({ importedCount: 1, skippedCount: 0 });
    await imported.promise;
  });
  expect(state.createProject).toHaveBeenCalledOnce();
  expect(state.importThreads).toHaveBeenCalledOnce();
  expect(state.completeOnboarding).toHaveBeenCalledOnce();
  expect(state.onDone).toHaveBeenCalledOnce();
});

it("finishes setup without landing when the imported project never reaches the client", async () => {
  using _now = setup();
  state.candidates = state.candidates.slice(0, 1);
  // The server accepts the project, but it never shows up in the client's projects.
  state.createProject.mockResolvedValue(AsyncResult.success(undefined));
  state.waitForProject.mockRejectedValue(new Error("The project did not appear."));
  state.completeOnboarding.mockRejectedValueOnce(new Error("offline"));
  await using _screen = await mountImport();

  await click("Import 1 project");
  await vi.waitFor(() => expect(state.completeOnboarding).toHaveBeenCalledOnce());
  // A failed completion hands the step back instead of leaving it importing.
  await vi.waitFor(() => expect(button("Import 1 project").disabled).toBe(false));
  expect(state.onDone).not.toHaveBeenCalled();

  await click("Import 1 project");
  await vi.waitFor(() => expect(state.onDone).toHaveBeenCalledOnce());
  expect(state.onDone).toHaveBeenCalledWith(undefined);
});
