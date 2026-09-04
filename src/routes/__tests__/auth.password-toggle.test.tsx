import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter, createRootRoute, createRoute } from "@tanstack/react-router";
import { Route as AuthRoute } from "../auth";

const rootRoute = createRootRoute();
const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth",
  component: AuthRoute.options.component,
});
const forgotRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth/forgot",
  component: () => <div>Forgot</div>,
});
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <div>Home</div>,
});

rootRoute.addChildren([authRoute, forgotRoute, indexRoute]);

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const router = createRouter({
    routeTree: rootRoute,
    context: { queryClient: new QueryClient() },
    defaultPreload: "intent",
  });
  await act(() => router.navigate({ to: "/auth" }));
  const root = createRoot(container);
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
  });
  return { container, cleanup: () => { root.unmount(); container.remove(); } };
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null } })),
      signInWithPassword: vi.fn(() => Promise.resolve({ error: null })),
      signUp: vi.fn(() => Promise.resolve({ error: null })),
    },
  },
}));

describe("Auth password visibility toggle", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("hides password by default", async () => {
    const { container, cleanup } = await mount();
    const input = container.querySelector('input[type="password"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input?.placeholder.toLowerCase()).toContain("password");
    cleanup();
  });

  it("reveals password when toggled", () => {
    const { container, cleanup } = mount();
    const toggle = container.querySelector('button[aria-label="Show password"]') as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    act(() => toggle?.click());
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input?.placeholder.toLowerCase()).toContain("password");
    cleanup();
  });

  it("hides password when toggled again", () => {
    const { container, cleanup } = mount();
    const showBtn = container.querySelector('button[aria-label="Show password"]') as HTMLButtonElement;
    act(() => showBtn?.click());
    const hideBtn = container.querySelector('button[aria-label="Hide password"]') as HTMLButtonElement;
    act(() => hideBtn?.click());
    const input = container.querySelector('input[type="password"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    cleanup();
  });

  it("preserves password value while toggling", () => {
    const { container, cleanup } = mount();
    const input = container.querySelector('input[type="password"]') as HTMLInputElement;
    act(() => {
      input.value = "secret123";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const showBtn = container.querySelector('button[aria-label="Show password"]') as HTMLButtonElement;
    act(() => showBtn?.click());
    expect((container.querySelector('input[type="text"]') as HTMLInputElement)?.value).toBe("secret123");
    const hideBtn = container.querySelector('button[aria-label="Hide password"]') as HTMLButtonElement;
    act(() => hideBtn?.click());
    expect((container.querySelector('input[type="password"]') as HTMLInputElement)?.value).toBe("secret123");
    cleanup();
  });

  it("toggle has type button and does not submit the form", () => {
    const { container, cleanup } = mount();
    const toggle = container.querySelector('button[aria-label="Show password"]') as HTMLButtonElement;
    expect(toggle?.getAttribute("type")).toBe("button");
    cleanup();
  });
});
