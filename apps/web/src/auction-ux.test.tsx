import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { Listing } from "./types";

const socketHarness = vi.hoisted(() => ({
  listeners: new Map<string, (event?: { listingId?: string }) => void>(),
  emit: vi.fn(),
  disconnect: vi.fn()
}));

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => ({
    on: (event: string, listener: (event?: { listingId?: string }) => void) => {
      socketHarness.listeners.set(event, listener);
    },
    emit: socketHarness.emit,
    disconnect: socketHarness.disconnect
  }))
}));

const student = { id: "student-id", email: "student@kongu.edu", displayName: "Kongu Student", verified: true };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  socketHarness.listeners.clear();
  socketHarness.emit.mockClear();
  socketHarness.disconnect.mockClear();
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
  it("subscribes authenticated marketplace viewers and refreshes the leading bid live", async () => {
    let leadingAmount: number | null = null;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/auth/me")) return Response.json({ user: student });
      if (url.includes("/listings?")) {
        return Response.json({
          items: [listing({ leadingAmount, minimumNextBid: leadingAmount === null ? 200 : leadingAmount + 20 })],
          total: 1,
          pages: 1
        });
      }
      return Response.json({ error: "Unexpected request." }, { status: 404 });
    });
    render(<MemoryRouter><App /></MemoryRouter>);

    expect(await screen.findByText("₹200.00")).toBeInTheDocument();
    socketHarness.listeners.get("connect")?.();
    expect(socketHarness.emit).toHaveBeenCalledWith("auction:subscribe", "507f1f77bcf86cd799439011");

    leadingAmount = 250;
    socketHarness.listeners.get("auction:updated")?.({ listingId: "507f1f77bcf86cd799439011" });
    expect(await screen.findByText("₹250.00")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/listings?")).length).toBeGreaterThan(1);
  });

  it("refreshes public marketplace bids for signed-out viewers", async () => {
    let leadingAmount: number | null = null;
    let refreshPublicListings: (() => void) | undefined;
    vi.spyOn(window, "setInterval").mockImplementation(((handler: TimerHandler, delay?: number) => {
      if (delay === 15_000 && typeof handler === "function") refreshPublicListings = handler as () => void;
      return 1;
    }) as typeof window.setInterval);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/auth/me")) return Response.json({ user: null });
      if (url.includes("/listings?")) {
        return Response.json({
          items: [listing({ leadingAmount, minimumNextBid: leadingAmount === null ? 200 : leadingAmount + 20 })],
          total: 1,
          pages: 1
        });
      }
      return Response.json({ error: "Unexpected request." }, { status: 404 });
    });
    render(<MemoryRouter><App /></MemoryRouter>);

    expect(await screen.findByText("₹200.00")).toBeInTheDocument();
    expect(refreshPublicListings).toBeDefined();
    leadingAmount = 250;
    await act(async () => {
      refreshPublicListings?.();
    });
    expect(await screen.findByText("₹250.00")).toBeInTheDocument();
  });

  it("refreshes seller listing cards from the auction update event", async () => {
    let leadingAmount = 800;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/auth/me")) return Response.json({ user: student });
      if (url.endsWith("/listings/mine")) {
        return Response.json({ items: [listing({ isSeller: true, leadingAmount, minimumNextBid: leadingAmount + 20 })] });
      }
      return Response.json({ error: "Unexpected request." }, { status: 404 });
    });
    render(<MemoryRouter initialEntries={["/my-listings"]}><App /></MemoryRouter>);

    expect(await screen.findByText("₹800.00")).toBeInTheDocument();
    socketHarness.listeners.get("connect")?.();
    expect(socketHarness.emit).toHaveBeenCalledWith("auction:subscribe", "507f1f77bcf86cd799439011");

    leadingAmount = 900;
    await act(async () => {
      socketHarness.listeners.get("auction:updated")?.({ listingId: "507f1f77bcf86cd799439011" });
    });
    expect(await screen.findByText("₹900.00")).toBeInTheDocument();
    expect(screen.getByText("Minimum next bid: ₹920.00")).toBeInTheDocument();
    expect(screen.getByText("Your listing")).toBeInTheDocument();
  });

  it("shows sellers their highest bid without allowing self-bidding or early decisions", async () => {
    const activeSellerListing = listing({
      isSeller: true,
      leadingAmount: 800,
      minimumNextBid: 850,
      bidHistory: [{ id: "bid-id", bidderAlias: "Other Student", amount: 800, type: "manual", createdAt: new Date().toISOString() }]
    });
    installApi({ currentUser: student, auction: activeSellerListing });
    render(<MemoryRouter initialEntries={["/listings/507f1f77bcf86cd799439011"]}><App /></MemoryRouter>);

    expect(await screen.findByText("Current highest bid")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getAllByText("₹800.00")).toHaveLength(2);
    expect(screen.getByText("₹850.00")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /place bid/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("allows another user to bid on an active auction without showing a closed message", async () => {
    let activeAuction = listing({ leadingAmount: 800, minimumNextBid: 820 });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/auth/me")) return Response.json({ user: student });
      if (url.endsWith("/bids") && init?.method === "POST") {
        activeAuction = {
          ...activeAuction,
          leadingAmount: 820,
          minimumNextBid: 840,
          bidHistory: [{ id: "new-bid", bidderAlias: student.displayName, amount: 820, type: "manual", createdAt: new Date().toISOString() }, ...activeAuction.bidHistory]
        };
        return Response.json({ listing: activeAuction }, { status: 201 });
      }
      if (url.includes("/listings/")) return Response.json({ listing: activeAuction, bidHistory: activeAuction.bidHistory });
      return Response.json({ error: "Unexpected request." }, { status: 404 });
    });
    render(<MemoryRouter initialEntries={["/listings/507f1f77bcf86cd799439011"]}><App /></MemoryRouter>);

    expect(await screen.findByText("Current highest bid")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Your bid (₹)" })).toHaveAttribute("min", "820");
    expect(screen.getByRole("button", { name: /place bid/i })).toBeInTheDocument();
    expect(screen.queryByText("This auction has closed. The seller is reviewing the leading bid.")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Your bid (₹)" }), { target: { value: "820" } });
    fireEvent.click(screen.getByRole("button", { name: /place bid/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/bids"),
      expect.objectContaining({ method: "POST", body: JSON.stringify({ amount: 820 }) })
    ));
    expect(await screen.findByText("₹840.00")).toBeInTheDocument();
  });

  it("does not let an older auction refresh overwrite the latest bid", async () => {
    let activeAuction = listing({ leadingAmount: 800, minimumNextBid: 820 });
    let detailRequests = 0;
    let resolveOlderRequest: ((response: Response) => void) | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/auth/me")) return Response.json({ user: student });
      if (url.includes("/listings/")) {
        detailRequests += 1;
        if (detailRequests === 2) {
          return new Promise((resolve) => { resolveOlderRequest = resolve; });
        }
        return Response.json({ listing: activeAuction, bidHistory: activeAuction.bidHistory });
      }
      return Response.json({ error: "Unexpected request." }, { status: 404 });
    });
    render(<MemoryRouter initialEntries={["/listings/507f1f77bcf86cd799439011"]}><App /></MemoryRouter>);
    expect(await screen.findByText("₹800.00")).toBeInTheDocument();
    socketHarness.listeners.get("connect")?.();

    activeAuction = listing({ leadingAmount: 850, minimumNextBid: 870 });
    await act(async () => socketHarness.listeners.get("auction:updated")?.({ listingId: activeAuction._id }));
    activeAuction = listing({ leadingAmount: 900, minimumNextBid: 920 });
    await act(async () => socketHarness.listeners.get("auction:updated")?.({ listingId: activeAuction._id }));
    expect(await screen.findByText("₹900.00")).toBeInTheDocument();

    await act(async () => {
      resolveOlderRequest?.(Response.json({ listing: listing({ leadingAmount: 850, minimumNextBid: 870 }), bidHistory: [] }));
    });
    expect(screen.queryByText("₹850.00")).not.toBeInTheDocument();
    expect(screen.getByText("₹900.00")).toBeInTheDocument();
  });

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
      leadingAmount: 220,
      minimumNextBid: 240,
      provisionalWinner: { displayName: "Winning Bidder", amount: 220 },
      bidHistory: [{ id: "bid-id", bidderAlias: "Bidder", amount: 220, type: "manual", createdAt: new Date().toISOString() }]
    });
    installApi({ auction: eligible });
    render(<MemoryRouter initialEntries={["/listings/507f1f77bcf86cd799439011"]}><App /></MemoryRouter>);
    const approveButton = await screen.findByRole("button", { name: "Approve" });
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.getByText("Awaiting seller approval")).toBeInTheDocument();
    expect(screen.getByText("Winning Bidder")).toBeInTheDocument();
    expect(screen.getByText("Current highest bid").parentElement?.parentElement).toContainElement(approveButton);

    cleanup();
    installApi({ auction: listing({ biddingStatus: "Closed", saleOutcome: "Unsold", isSeller: true }) });
    render(<MemoryRouter initialEntries={["/listings/507f1f77bcf86cd799439011"]}><App /></MemoryRouter>);
    expect(await screen.findByText("No bids were received. This item is unsold.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("persists seller rejection and hides the decision controls", async () => {
    let auction = listing({
      biddingStatus: "Closed",
      saleOutcome: "Pending seller decision",
      isSeller: true,
      leadingAmount: 220,
      minimumNextBid: 240,
      provisionalWinner: { displayName: "Winning Bidder", amount: 220 },
      bidHistory: [{ id: "bid-id", bidderAlias: "Winning Bidder", amount: 220, type: "manual", createdAt: new Date().toISOString() }]
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/auth/me")) return Response.json({ user: student });
      if (url.endsWith("/decision") && init?.method === "POST") {
        auction = { ...auction, saleOutcome: "Rejected", provisionalWinner: undefined };
        return Response.json({ saleOutcome: "Rejected" });
      }
      if (url.includes("/listings/")) return Response.json({ listing: auction, bidHistory: auction.bidHistory });
      return Response.json({ error: "Unexpected request." }, { status: 404 });
    });
    render(<MemoryRouter initialEntries={["/listings/507f1f77bcf86cd799439011"]}><App /></MemoryRouter>);

    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    expect(await screen.findByText("The seller declined this winning bid.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/decision"),
      expect.objectContaining({ method: "POST", body: JSON.stringify({ decision: "reject" }) })
    );
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

  it("keeps a successfully loaded cached image visible after mounting", async () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(318);
    const auction = listing({ photos: ["/uploads/photo.png"] });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/auth/me")) return Response.json({ user: null });
      if (url.includes("/listings?")) return Response.json({ items: [auction], total: 1, pages: 1 });
      return Response.json({ error: "Unexpected request." }, { status: 404 });
    });
    render(<MemoryRouter><App /></MemoryRouter>);

    const image = await screen.findByRole("img", { name: "Campus calculator" });
    await waitFor(() => expect(image.className).toContain("opacity-100"));
    expect(screen.queryByLabelText("Loading image")).not.toBeInTheDocument();
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
