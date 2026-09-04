import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { Field } from "../auth";

function mountPasswordField() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let value = "";
  function onChange(v: string) {
    value = v;
    rerender(value);
  }
  function rerender(current: string) {
    act(() => {
      root.render(
        <Field
          icon={<span data-testid="lock">L</span>}
          type="password"
          placeholder="Password (min 8 chars)"
          value={current}
          onChange={onChange}
        />
      );
    });
  }
  rerender(value);
  return {
    container,
    getValue: () => value,
    cleanup: () => { root.unmount(); container.remove(); },
  };
}

describe("Auth password visibility toggle", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("hides password by default", () => {
    const { container, cleanup } = mountPasswordField();
    const input = container.querySelector('input[type="password"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input?.placeholder.toLowerCase()).toContain("password");
    cleanup();
  });

  it("reveals password when toggled", () => {
    const { container, cleanup } = mountPasswordField();
    const toggle = container.querySelector('button[aria-label="Show password"]') as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    act(() => toggle?.click());
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    cleanup();
  });

  it("hides password when toggled again", () => {
    const { container, cleanup } = mountPasswordField();
    const showBtn = container.querySelector('button[aria-label="Show password"]') as HTMLButtonElement;
    act(() => showBtn?.click());
    const hideBtn = container.querySelector('button[aria-label="Hide password"]') as HTMLButtonElement;
    act(() => hideBtn?.click());
    const input = container.querySelector('input[type="password"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    cleanup();
  });

  it("preserves password value while toggling", () => {
    const { container, getValue, cleanup } = mountPasswordField();
    const input = container.querySelector('input[type="password"]') as HTMLInputElement;
    act(() => {
      input.value = "secret123";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(getValue()).toBe("secret123");
    const showBtn = container.querySelector('button[aria-label="Show password"]') as HTMLButtonElement;
    act(() => showBtn?.click());
    expect((container.querySelector('input[type="text"]') as HTMLInputElement)?.value).toBe("secret123");
    const hideBtn = container.querySelector('button[aria-label="Hide password"]') as HTMLButtonElement;
    act(() => hideBtn?.click());
    expect((container.querySelector('input[type="password"]') as HTMLInputElement)?.value).toBe("secret123");
    cleanup();
  });

  it("toggle has type button and does not submit the form", () => {
    const { container, cleanup } = mountPasswordField();
    const toggle = container.querySelector('button[aria-label="Show password"]') as HTMLButtonElement;
    expect(toggle?.getAttribute("type")).toBe("button");
    cleanup();
  });

  it("updates accessible label to Hide password when visible", () => {
    const { container, cleanup } = mountPasswordField();
    const showBtn = container.querySelector('button[aria-label="Show password"]') as HTMLButtonElement;
    act(() => showBtn?.click());
    expect(container.querySelector('button[aria-label="Hide password"]')).not.toBeNull();
    cleanup();
  });
});
