import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter, createRootRoute, createRoute } from "@tanstack/react-router";
import AuthRoute from "../auth";

const rootRoute = createRootRoute();
const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth",
  component: AuthRoute.component,
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

function Wrapper() {
  const router = createRouter({
    routeTree: rootRoute,
    context: { queryClient: new QueryClient() },
    defaultPreload: "intent",
  });
  return (
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
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
  it("hides password by default", () => {
    render(<Wrapper />);
    const inputs = screen.getAllByPlaceholderText(/password/i);
    expect(inputs[0]).toHaveAttribute("type", "password");
  });

  it("reveals password when toggled", () => {
    render(<Wrapper />);
    const inputs = screen.getAllByPlaceholderText(/password/i);
    const toggle = screen.getByRole("button", { name: /show password/i });
    fireEvent.click(toggle);
    expect(inputs[0]).toHaveAttribute("type", "text");
  });

  it("hides password when toggled again", () => {
    render(<Wrapper />);
    const inputs = screen.getAllByPlaceholderText(/password/i);
    const toggle = screen.getByRole("button", { name: /show password/i });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(inputs[0]).toHaveAttribute("type", "password");
  });

  it("preserves password value while toggling", () => {
    render(<Wrapper />);
    const input = screen.getAllByPlaceholderText(/password/i)[0];
    fireEvent.change(input, { target: { value: "secret123" } });
    const toggle = screen.getByRole("button", { name: /show password/i });
    fireEvent.click(toggle);
    expect(input).toHaveValue("secret123");
    fireEvent.click(toggle);
    expect(input).toHaveValue("secret123");
  });

  it("does not submit the form when clicked", () => {
    const signIn = vi.fn();
    vi.doMock("@/integrations/supabase/client", () => ({
      supabase: {
        auth: {
          getSession: vi.fn(() => Promise.resolve({ data: { session: null } })),
          signInWithPassword: signIn,
          signUp: vi.fn(() => Promise.resolve({ error: null })),
        },
      },
    }));
    render(<Wrapper />);
    const toggle = screen.getByRole("button", { name: /show password/i });
    fireEvent.click(toggle);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("changes accessible label to Hide password when visible", () => {
    render(<Wrapper />);
    const toggle = screen.getByRole("button", { name: /show password/i });
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: /hide password/i })).toBeInTheDocument();
  });
});
