import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const signedInUser = {
  id: "student-1",
  email: "student@kongu.edu",
  displayName: "Campus Student",
  verified: true
};

function mockAuthApi(user: typeof signedInUser | null = signedInUser) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/auth/me")) return new Response(JSON.stringify({ user }), { status: 200 });
    if (url.includes("/auth/logout")) return new Response(null, { status: 204 });
    if (url.includes("/listings")) return new Response(JSON.stringify({ items: [], total: 0, pages: 0 }), { status: 200 });
    return new Response(JSON.stringify({ error: "Unexpected test request." }), { status: 404 });
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("profile navigation and authentication checks", () => {
  it("opens the profile from the avatar without logging out and shows available account details", async () => {
    const fetchMock = mockAuthApi();
    render(<MemoryRouter><App /></MemoryRouter>);

    fireEvent.click(await screen.findByRole("link", { name: "Profile" }));

    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
    const profileDetails = within(screen.getByRole("region", { name: "Profile details" }));
    expect(profileDetails.getByRole("heading", { name: "Campus Student" })).toBeInTheDocument();
    expect(profileDetails.getAllByText("student@kongu.edu")).toHaveLength(2);
    expect(profileDetails.getByText("Verified")).toBeInTheDocument();
    expect(profileDetails.getByText("Not provided")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log Out" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/auth/logout"))).toBe(false);
  });

  it("logs out only from the profile action and redirects protected content", async () => {
    const fetchMock = mockAuthApi();
    render(<MemoryRouter initialEntries={["/profile"]}><App /></MemoryRouter>);

    fireEvent.click(await screen.findByRole("button", { name: "Log Out" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/auth/logout"))).toBe(true));
    expect(await screen.findByRole("link", { name: "Log in" })).toBeInTheDocument();
  });

  it("keeps the profile link in the mobile menu and protects the profile route", async () => {
    const fetchMock = mockAuthApi();
    render(<MemoryRouter><App /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Toggle menu" }));
    fireEvent.click(screen.getByText("Profile", { selector: "a" }));

    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/auth/logout"))).toBe(false);
  });

  it("redirects signed-out visitors away from the protected profile page", async () => {
    mockAuthApi(null);
    render(<MemoryRouter initialEntries={["/profile"]}><App /></MemoryRouter>);

    expect(await screen.findByText("Welcome back")).toBeInTheDocument();
  });

  it("does not render a theme toggle anywhere in the navigation or profile", async () => {
    mockAuthApi();
    render(<MemoryRouter initialEntries={["/profile"]}><App /></MemoryRouter>);

    await screen.findByRole("heading", { name: "Profile" });
    expect(screen.queryByRole("button", { name: /Dark mode|Light mode|Switch to .* mode/i })).not.toBeInTheDocument();
  });

  it("deduplicates Strict Mode auth checks and presents rate limits without retrying", async () => {
    let authRequests = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/auth/me")) {
        authRequests += 1;
        if (authRequests === 1) {
          return new Response(JSON.stringify({ error: "Too many failed authentication attempts. Try again later." }), {
            status: 429,
            headers: { "Retry-After": "120" }
          });
        }
        return Response.json({ user: null });
      }
      if (String(input).includes("/listings")) return Response.json({ items: [], total: 0, pages: 0 });
      return Response.json({ error: "Unexpected test request." }, { status: 404 });
    });

    render(<StrictMode><MemoryRouter><App /></MemoryRouter></StrictMode>);

    expect(await screen.findByText("Too many failed authentication attempts. Try again later. Try again in about 2 minutes.")).toBeInTheDocument();
    expect(authRequests).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(authRequests).toBe(2));
    await waitFor(() => expect(screen.queryByText(/Too many failed authentication attempts/)).not.toBeInTheDocument());
  });
});
