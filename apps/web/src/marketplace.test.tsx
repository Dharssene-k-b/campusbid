import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CampusBid marketplace", () => {
  it("shows a real empty state and submits selected filters to the API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/auth/me")) return new Response(JSON.stringify({ user: null }), { status: 200 });
      if (url.includes("/listings")) return new Response(JSON.stringify({ items: [], total: 0, pages: 0 }), { status: 200 });
      return new Response(JSON.stringify({ error: "Unexpected test request." }), { status: 404 });
    });

    render(<MemoryRouter><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Nothing here just yet" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Calculators" } });
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes("category=Calculators"))).toBe(true);
    });
    expect(screen.getByRole("heading", { name: "Find your next thing." })).toBeInTheDocument();
  });
});
