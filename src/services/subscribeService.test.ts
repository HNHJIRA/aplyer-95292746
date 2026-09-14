import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribe, SUBSCRIBE_TIMEOUT_MS, UPLOAD_TIMEOUT_MS } from "./subscribeService";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("subscribe", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("submits a valid email and optional first name with the existing payload", async () => {
    fetchMock.mockResolvedValueOnce(response({ ok: true }));
    const form = new FormData();
    form.append("email", "person@example.com");
    form.append("firstName", "Ada");

    await expect(subscribe(form)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(form);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns the backend validation or duplicate response", async () => {
    fetchMock.mockResolvedValueOnce(response({ error: "This email address appears to be invalid." }, 400));
    const form = new FormData();
    form.append("email", "invalid");

    await expect(subscribe(form)).resolves.toEqual({
      ok: false,
      error: "This email address appears to be invalid.",
    });
  });

  it("uploads optional files only after subscription succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ ok: true }))
      .mockResolvedValueOnce(response({ ok: true }));
    const form = new FormData();
    form.append("email", "person@example.com");
    form.append("firstName", "Ada");
    form.append("writingSample", "My writing voice");
    form.append("resume", new File(["resume"], "resume.pdf", { type: "application/pdf" }));

    await expect(subscribe(form)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, uploadInit] = fetchMock.mock.calls[1];
    const upload = uploadInit?.body as FormData;
    expect(upload.get("email")).toBe("person@example.com");
    expect(upload.get("name")).toBe("Ada");
    expect(upload.get("source")).toBe("waitlist-form");
    expect(upload.get("resume")).toBeInstanceOf(File);
  });

  it("does not silently succeed when an optional file upload fails", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ ok: true }))
      .mockResolvedValueOnce(response({ error: "Upload unavailable." }, 503));
    const form = new FormData();
    form.append("email", "person@example.com");
    form.append("resume", new File(["resume"], "resume.pdf"));

    await expect(subscribe(form)).resolves.toEqual({ ok: false, error: "Upload unavailable." });
  });

  it("returns a safe network error and allows the caller to retry", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("network details"));
    await expect(subscribe(new FormData())).resolves.toEqual({
      ok: false,
      error: "Something went wrong. Please try again.",
    });
  });

  it("returns a clear timeout error", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    await expect(subscribe(new FormData())).resolves.toEqual({
      ok: false,
      error: "The request took too long. Please try again.",
    });
    expect(SUBSCRIBE_TIMEOUT_MS).toBe(25_000);
    expect(UPLOAD_TIMEOUT_MS).toBe(30_000);
  });
});