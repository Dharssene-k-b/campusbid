import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function installRegistrationApi() {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/auth/me")) return new Response(JSON.stringify({ user: null }), { status: 200 });
    if (url.includes("/listings")) return new Response(JSON.stringify({ items: [], total: 0, pages: 0 }), { status: 200 });
    if (url.includes("/auth/register")) return new Response(JSON.stringify({
      message: "Registration successful.",
      developmentVerificationToken: "development-token"
    }), { status: 201 });
    return new Response(JSON.stringify({ error: `Unexpected request ${init?.method ?? "GET"} ${url}` }), { status: 404 });
  });
  return fetchMock;
}

describe("CampusBid registration validation", () => {
  it("shows field-specific email and password errors and prevents an invalid request", async () => {
    const fetchMock = installRegistrationApi();
    render(<MemoryRouter initialEntries={["/register"]}><App /></MemoryRouter>);
    const email = await screen.findByLabelText("College email");
    const password = screen.getByLabelText("Password");

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Kongu Student" } });
    fireEvent.change(email, { target: { value: "student@gmail.com" } });
    fireEvent.change(password, { target: { value: "Campus @123" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Please use a valid Kongu college email ending in @kongu.edu.")).toBeInTheDocument();
    expect(screen.getByText("Password must be at least 8 characters and include uppercase, lowercase, a number, and a special character. Spaces are not allowed.")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input, init]) => String(input).includes("/auth/register") && init?.method === "POST")).toBe(false);
    });
  });

  it("trims and normalizes a valid Kongu email without changing the password", async () => {
    const fetchMock = installRegistrationApi();
    render(<MemoryRouter initialEntries={["/register"]}><App /></MemoryRouter>);

    fireEvent.change(await screen.findByLabelText("Display name"), { target: { value: "Kongu Student" } });
    fireEvent.change(screen.getByLabelText("College email"), { target: { value: "  Student+Lab@KONGU.EDU  " } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Campus@123" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await screen.findByText("Verify your email (local development)");
    const request = fetchMock.mock.calls.find(([input, init]) => String(input).includes("/auth/register") && init?.method === "POST");
    expect(request).toBeDefined();
    const payload = JSON.parse(String(request?.[1]?.body)) as { email: string; password: string };
    expect(payload.email).toBe("student+lab@kongu.edu");
    expect(payload.password).toBe("Campus@123");
  });
});
