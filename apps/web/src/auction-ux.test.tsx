import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { Listing } from "./types";

const student = { id: "student-id", email: "student@kongu.edu", displayName: "Kongu Student", verified: true };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    _id: "507f1f77bcf86cd799439011",
    title: "Campus calculator",
    category: "Calculators",
    description: "A tested scientific calculator in good condition.",
    condition: "Good",
    photos: [],
    startingPrice: 200,
    minimumIncrement: 20,
    leadingAmount: null,
    minimumNextBid: 200,
    closesAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    biddingStatus: "Open",
    saleOutcome: "Pending seller decision",
    bidHistory: [],
    ...overrides
  };
}

function installApi(options: {
  currentUser?: { id: string; email: string; displayName: string; verified: boolean } | null;
  auction?: Listing;
  upload?: (file: File) => Response | Promise<Response>;
} = {}) {
  const auction = options.auction ?? listing();
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/auth/me")) return Response.json({ user: options.currentUser ?? null });
    if (url.includes("/listings/") && init?.method === "POST") {
      if (url.includes("/cancel")) return Response.json({ listing: { ...auction, biddingStatus: "Cancelled", saleOutcome: "Cancelled" } });
      return Response.json({ error: "Unexpected auction action." }, { status: 409 });
    }
    if (url.includes("/listings/") && !url.includes("/listings/new")) {
      return Response.json({ listing: auction, bidHistory: auction.bidHistory });
    }
    if (url.endsWith("/uploads") && init?.method === "POST") {
      const file = (init.body as FormData).get("photo") as File;
      return options.upload?.(file) ?? Response.json({ url: `/api/uploads/${file.name}` }, { status: 201 });
    }
    if (url.endsWith("/listings") && init?.method === "POST") return Response.json({ listing: auction }, { status: 201 });
    return Response.json({ error: `Unexpected test request ${init?.method ?? "GET"} ${url}` }, { status: 404 });
  });
  return fetchMock;
}

describe("CampusBid photo upload UX", () => {
  it("uploads dropped images, previews them, and allows removing an individual photo", async () => {
    installApi({ currentUser: student });
    render(<MemoryRouter initialEntries={["/listings/new"]}><App /></MemoryRouter>);
    const dropZone = await screen.findByRole("region", { name: "Photo upload area" });
    const image = new File(["image-content"], "calculator.png", { type: "image/png", lastModified: 1 });

    fireEvent.dragEnter(dropZone, { dataTransfer: { files: [image] } });
    expect(dropZone.className).toContain("border-forest");
    fireEvent.drop(dropZone, { dataTransfer: { files: [image] } });

    const preview = await screen.findByAltText("Auction item preview");
    expect(preview).toHaveAttribute("src", "/api/uploads/calculator.png");
    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    await waitFor(() => expect(screen.queryByAltText("Auction item preview")).not.toBeInTheDocument());
  });

  it("shows a local image preview while the upload is still pending", async () => {
    let completeUpload: ((response: Response) => void) | undefined;
    installApi({
      currentUser: student,
      upload: () => new Promise((resolve) => { completeUpload = resolve; })
    });
    render(<MemoryRouter initialEntries={["/listings/new"]}><App /></MemoryRouter>);
    const dropZone = await screen.findByRole("region", { name: "Photo upload area" });
    const image = new File(["image-content"], "instant.png", { type: "image/png" });

    fireEvent.drop(dropZone, { dataTransfer: { files: [image] } });

    const localPreview = await screen.findByAltText("instant.png preview");
    expect(localPreview.getAttribute("src")).toMatch(/^blob:/);
    completeUpload?.(Response.json({ url: "/api/uploads/instant.png" }, { status: 201 }));
    expect(await screen.findByAltText("Auction item preview")).toHaveAttribute("src", "/api/uploads/instant.png");
  });

  it.each([
    ["text/plain", 10, "use a JPEG, PNG, or WebP image."],
    ["image/png", 5 * 1024 * 1024 + 1, "images must be 5 MB or smaller."]
  ])("rejects unsupported or oversized photo files", async (type, size, message) => {
    installApi({ currentUser: student });
    render(<MemoryRouter initialEntries={["/listings/new"]}><App /></MemoryRouter>);
    const input = await screen.findByLabelText("Choose item photos");
    const file = new File([new Uint8Array(size)], "invalid-photo", { type });

    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(globalThis.fetch).not.toHaveBeenCalledWith(expect.stringContaining("/uploads"), expect.anything());
  });

  it("shows upload failures without adding a broken preview", async () => {
    installApi({
      currentUser: student,
      upload: () => Response.json({ error: "Image upload failed." }, { status: 400 })
    });
    render(<MemoryRouter initialEntries={["/listings/new"]}><App /></MemoryRouter>);
    const input = await screen.findByLabelText("Choose item photos");
    fireEvent.change(input, {
      target: { files: [new File(["image-content"], "failed.png", { type: "image/png" })] }
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("failed.png: Image upload failed.");
    expect(screen.queryByAltText("Auction item preview")).not.toBeInTheDocument();
  });
});

describe("CampusBid auction status actions", () => {
  it("hides cancellation after success and does not optimistically cancel on failure", async () => {
    const auction = listing({ isSeller: true });
    const fetchMock = installApi({ auction });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<MemoryRouter initialEntries={["/listings/507f1f77bcf86cd799439011"]}><App /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel auction" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cancel auction" })).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true);

    cleanup();
    vi.restoreAllMocks();
    installApi({
      auction,
      upload: () => Response.json({ error: "not used" }, { status: 400 })
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("/auth/me")) return Response.json({ user: null });
      if (String(input).includes("/listings/") && init?.method === "POST") return Response.json({ error: "Cancellation failed." }, { status: 409 });
      return Response.json({ listing: auction, bidHistory: auction.bidHistory });
    });
    render(<MemoryRouter initialEntries={["/listings/507f1f77bcf86cd799439011"]}><App /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel auction" }));
    expect(await screen.findByRole("button", { name: "Cancel auction" })).toBeInTheDocument();
  });

  it("only offers winning-bid decisions for a closed auction with a persisted winner", async () => {
    const eligible = listing({
      biddingStatus: "Closed",
      saleOutcome: "Pending seller decision",
      isSeller: true,
      hasProvisionalWinner: true,
      bidHistory: [{ id: "bid-id", bidderAlias: "Bidder", amount: 220, type: "manual", createdAt: new Date().toISOString() }]
    });
    installApi({ auction: eligible });
    render(<MemoryRouter initialEntries={["/listings/507f1f77bcf86cd799439011"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("button", { name: "Approve Winning Bid" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject Winning Bid" })).toBeInTheDocument();

    cleanup();
    installApi({ auction: listing({ biddingStatus: "Closed", saleOutcome: "Unsold", isSeller: true }) });
    render(<MemoryRouter initialEntries={["/listings/507f1f77bcf86cd799439011"]}><App /></MemoryRouter>);
    expect(await screen.findByText("No bids were received. This item is unsold.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve Winning Bid" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject Winning Bid" })).not.toBeInTheDocument();
  });

  it("does not offer cancellation for an already cancelled auction", async () => {
    installApi({ auction: listing({ biddingStatus: "Cancelled", saleOutcome: "Cancelled", isSeller: true }) });
    render(<MemoryRouter initialEntries={["/listings/507f1f77bcf86cd799439011"]}><App /></MemoryRouter>);

    await screen.findByText("This auction was cancelled by the seller.");
    expect(screen.queryByRole("button", { name: "Cancel auction" })).not.toBeInTheDocument();
  });

  it("uses accessible image URLs and shows an error fallback on cards and details", async () => {
    const auction = listing({ photos: ["/uploads/photo.png"] });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/auth/me")) return Response.json({ user: null });
      if (url.includes("/listings?")) return Response.json({ items: [auction], total: 1, pages: 1 });
      if (url.includes("/listings/")) return Response.json({ listing: auction, bidHistory: auction.bidHistory });
      return Response.json({ error: "Unexpected request." }, { status: 404 });
    });
    const view = render(<MemoryRouter><App /></MemoryRouter>);
    const cardImage = await screen.findByRole("img", { name: "Campus calculator" });
    expect(cardImage).toHaveAttribute("src", "/api/uploads/photo.png");
    fireEvent.error(cardImage);
    expect(await screen.findByRole("img", { name: "Campus calculator: photo unavailable" })).toBeInTheDocument();

    view.unmount();
    render(<MemoryRouter initialEntries={["/listings/507f1f77bcf86cd799439011"]}><App /></MemoryRouter>);
    const detailImage = await screen.findByRole("img", { name: "Campus calculator" });
    expect(detailImage).toHaveAttribute("src", "/api/uploads/photo.png");
    fireEvent.error(detailImage);
    expect(await screen.findByRole("img", { name: "Campus calculator: photo unavailable" })).toBeInTheDocument();
  });

  it("recalculates the countdown on focus and refreshes the auction when it expires", async () => {
    let currentTime = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => currentTime);
    const auction = listing({ closesAt: new Date(currentTime + 60_000).toISOString() });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/auth/me")) return Response.json({ user: null });
      if (url.includes("/listings?")) return Response.json({ items: [auction], total: 1, pages: 1 });
      if (url.includes("/listings/")) return Response.json({ listing: auction, bidHistory: auction.bidHistory });
      return Response.json({ error: "Unexpected request." }, { status: 404 });
    });
    render(<MemoryRouter><App /></MemoryRouter>);

    expect(await screen.findByLabelText(/^Time remaining:/)).toHaveTextContent("00h 01m 00s");
    currentTime += 61_000;
    fireEvent.focus(window);

    expect(await screen.findByLabelText("Time remaining: Auction ended")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/listings/507f1f77bcf86cd799439011"))).toBe(true);
    });
  });

  it("restores a listing form draft and clears it after successful submission", async () => {
    const draftKey = "campusbid:listing-draft:new";
    sessionStorage.setItem(draftKey, JSON.stringify({
      values: {
        title: "Persisted calculator",
        category: "Calculators",
        condition: "Good",
        description: "A tested item restored from this browser session.",
        startingPrice: 200,
        minimumIncrement: 20,
        closesAt: new Date(Date.now() + 60 * 60 * 1000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
      },
      photos: ["/api/uploads/saved.png"]
    }));
    installApi({ currentUser: student });
    const view = render(<MemoryRouter initialEntries={["/listings/new"]}><App /></MemoryRouter>);
    expect(await screen.findByLabelText("Item title")).toHaveValue("Persisted calculator");
    expect(JSON.stringify(sessionStorage.getItem(draftKey))).not.toContain("password");
    view.unmount();

    installApi({ currentUser: student });
    render(<MemoryRouter initialEntries={["/listings/new"]}><App /></MemoryRouter>);
    expect(await screen.findByLabelText("Item title")).toHaveValue("Persisted calculator");
    fireEvent.click(screen.getByRole("button", { name: "Publish auction" }));
    await waitFor(() => expect(sessionStorage.getItem(draftKey)).toBeNull());
  });
});
