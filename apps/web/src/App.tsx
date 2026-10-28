import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useRef, useState, createContext, useContext, type FormEvent, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { io } from "socket.io-client";
import { z } from "zod";
import { konguEmailSchema, normalizedEmailSchema, registrationPasswordSchema } from "../../../shared/registration-validation.js";
import { api, ApiError } from "./api";
import { countdown, formatRupees, formatTime } from "./format";
import type { Listing, User } from "./types";

type AuthContextValue = { user: User | null; setUser: (user: User | null) => void; refreshUser: () => Promise<void> };
const AuthContext = createContext<AuthContextValue | null>(null);
type ToastMessage = { id: number; text: string; tone: "success" | "error" };
const ToastContext = createContext<(text: string, tone?: ToastMessage["tone"]) => void>(() => undefined);

function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("Auth context is missing.");
  return context;
}

function useToast() {
  return useContext(ToastContext);
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const refreshUser = useCallback(async () => {
    try {
      const result = await api<{ user: User | null }>("/auth/me");
      setUser(result.user);
    } catch (error) {
      if (error instanceof ApiError && error.status !== 401) throw error;
      setUser(null);
    }
  }, []);
  useEffect(() => {
    void refreshUser().finally(() => setAuthReady(true));
  }, [refreshUser]);

  const toast = useCallback((text: string, tone: ToastMessage["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, text, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((entry) => entry.id !== id)), 4200);
  }, []);

  if (!authReady) return <div className="min-h-screen bg-canvas" aria-label="Loading CampusBid" />;
  return (
    <AuthContext.Provider value={{ user, setUser, refreshUser }}>
      <ToastContext.Provider value={toast}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Marketplace />} />
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/register" element={<AuthPage mode="register" />} />
            <Route path="/verify" element={<VerifyPage />} />
            <Route path="/listings/new" element={<Protected><ListingForm /></Protected>} />
            <Route path="/listings/:id/edit" element={<Protected><ListingForm edit /></Protected>} />
            <Route path="/listings/:id" element={<ListingDetail />} />
            <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
            <Route path="/my-listings" element={<Protected><MyListings /></Protected>} />
            <Route path="/my-bids" element={<Protected><MyBids /></Protected>} />
            <Route path="/notifications" element={<Protected><Notifications /></Protected>} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
        <div className="fixed bottom-4 right-4 z-50 flex w-[min(90vw,360px)] flex-col gap-2" aria-live="polite">
          {toasts.map((message) => (
            <div key={message.id} role="status" className={`rounded-2xl px-4 py-3 text-sm text-white shadow-lg ${message.tone === "error" ? "bg-red-700" : "bg-forest"}`}>
              {message.text}
            </div>
          ))}
        </div>
      </ToastContext.Provider>
    </AuthContext.Provider>
  );
}

function Layout() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const logout = async () => {
    try {
      await api("/auth/logout", { method: "POST" });
      setUser(null);
      navigate("/");
      toast("You are signed out.");
    } catch (error) {
      toast(messageOf(error), "error");
    }
  };
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-30 border-b border-line/80 bg-canvas/95 backdrop-blur">
        <div className="page-shell flex h-[76px] items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-3 no-underline" aria-label="CampusBid home">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-forest text-lg font-bold text-white">C</span>
            <span className="text-xl font-black tracking-tight text-forest">campusbid<span className="text-sun">.</span></span>
          </Link>
          <nav className="hidden items-center gap-7 md:flex" aria-label="Main navigation">
            <Link className="nav-link" to="/">Explore</Link>
            {user && <Link className="nav-link" to="/dashboard">Dashboard</Link>}
            {user && <Link className="nav-link" to="/notifications">Notifications</Link>}
          </nav>
          <div className="hidden items-center gap-3 md:flex">
            {user ? (
              <>
                <Link to="/listings/new" className="button-primary !py-2.5">＋ List an item</Link>
                <button className="avatar-button" onClick={logout} title={`Sign out ${user.displayName}`} aria-label="Sign out">{initials(user.displayName)}</button>
              </>
            ) : (
              <>
                <Link to="/login" className="button-quiet">Log in</Link>
                <Link to="/register" className="button-primary !py-2.5">Join campus</Link>
              </>
            )}
          </div>
          <button className="rounded-xl border border-line px-3 py-2 md:hidden" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-label="Toggle menu">☰</button>
        </div>
        {menuOpen && <div className="page-shell flex flex-col gap-2 border-t border-line py-4 md:hidden">
          <Link onClick={() => setMenuOpen(false)} to="/">Explore</Link>
          {user ? <>
            <Link onClick={() => setMenuOpen(false)} to="/dashboard">Dashboard</Link>
            <Link onClick={() => setMenuOpen(false)} to="/listings/new">List an item</Link>
            <Link onClick={() => setMenuOpen(false)} to="/notifications">Notifications</Link>
            <button onClick={logout} className="text-left">Sign out</button>
          </> : <><Link to="/login">Log in</Link><Link to="/register">Join campus</Link></>}
        </div>}
      </header>
      <main className="min-h-[calc(100vh-150px)]"><Outlet /></main>
      <footer className="border-t border-line bg-white/50">
        <div className="page-shell flex flex-col justify-between gap-2 py-6 text-sm text-ink/60 sm:flex-row">
          <p>CampusBid · Better things, passed on.</p>
          <p>Campus-only auctions · Fair bids · Real handovers</p>
        </div>
      </footer>
    </div>
  );
}

function Protected({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function Marketplace() {
  const [search, setSearch] = useSearchParams();
  const [items, setItems] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const query = search.get("q") ?? "";
  const category = search.get("category") ?? "";
  const condition = search.get("condition") ?? "";
  const minPrice = search.get("minPrice") ?? "";
  const maxPrice = search.get("maxPrice") ?? "";
  const sort = search.get("sort") ?? "ending";
  const closingSoon = search.get("closingSoon") === "true";
  const filterKey = search.toString();
  const reload = useCallback(async (targetPage = 1) => {
    setLoading(true);
    setError("");
    const parameters = new URLSearchParams(filterKey);
    parameters.set("page", String(targetPage));
    try {
      const result = await api<{ items: Listing[]; total: number; pages: number }>(`/listings?${parameters.toString()}`);
      setItems(result.items);
      setTotal(result.total);
      setPages(Math.max(result.pages, 1));
      setPage(targetPage);
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setLoading(false);
    }
  }, [filterKey]);
  useEffect(() => { void reload(); }, [reload]);
  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearch(next);
  };

  return (
    <>
      <section className="relative overflow-hidden bg-forest text-white">
        <div className="soft-grid absolute inset-0 opacity-50" />
        <div className="page-shell relative grid gap-8 py-14 md:grid-cols-[1.25fr_.75fr] md:items-center md:py-20">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[.15em] text-mint">
              <span className="h-2 w-2 rounded-full bg-sun" /> Made for campus life
            </p>
            <h1 className="max-w-2xl font-display text-4xl leading-[1.08] tracking-tight sm:text-5xl md:text-6xl">Good things deserve<br className="hidden sm:block" /> a second <em className="text-[#e7b77e]">round.</em></h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-white/75">A fair place for students to find their next favourite thing. Browse real auctions, bid transparently, and pass useful stuff along.</p>
            <a href="#marketplace" className="mt-8 inline-flex items-center gap-3 rounded-xl bg-[#ef9c55] px-5 py-3 font-semibold text-ink hover:bg-[#f2ac72]">Explore the marketplace <span aria-hidden="true">↓</span></a>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="min-h-36 rounded-[26px] border border-white/10 bg-white/10 p-5 backdrop-blur-sm">
              <span className="text-3xl" aria-hidden="true">🚲</span>
              <p className="mt-8 text-sm font-medium text-white/75">The next campus ride</p>
            </div>
            <div className="mt-9 min-h-36 rounded-[26px] border border-white/10 bg-[#e6c6a4] p-5 text-ink">
              <span className="text-3xl" aria-hidden="true">📚</span>
              <p className="mt-8 text-sm font-medium">Books with another chapter</p>
            </div>
            <div className="min-h-36 rounded-[26px] border border-white/10 bg-[#d6e0d1] p-5 text-ink">
              <span className="text-3xl" aria-hidden="true">🧮</span>
              <p className="mt-8 text-sm font-medium">Tools for the next semester</p>
            </div>
            <div className="min-h-36 rounded-[26px] border border-white/10 bg-white/10 p-5 backdrop-blur-sm">
              <span className="text-3xl" aria-hidden="true">🎧</span>
              <p className="mt-8 text-sm font-medium text-white/75">Good tech, good value</p>
            </div>
          </div>
        </div>
      </section>

      <section id="marketplace" className="page-shell py-12 md:py-16">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="section-kicker">The marketplace</p>
            <h2 className="mt-2 font-display text-3xl md:text-4xl">Find your next thing.</h2>
          </div>
          <p className="text-sm text-ink/55">{total} {total === 1 ? "auction" : "auctions"} open</p>
        </div>
        <div className="mb-7 rounded-3xl border border-line bg-white p-4 shadow-card md:p-5">
          <form onSubmit={(event) => { event.preventDefault(); updateFilter("q", (event.currentTarget.elements.namedItem("q") as HTMLInputElement).value); }} className="flex flex-col gap-3 sm:flex-row">
            <label className="sr-only" htmlFor="market-search">Search auctions</label>
            <div className="relative flex-1">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg text-ink/45" aria-hidden="true">⌕</span>
              <input id="market-search" name="q" defaultValue={query} className="field !pl-11" placeholder="Search calculators, cycles, books…" />
            </div>
            <button className="button-primary sm:min-w-32">Search items</button>
          </form>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <SelectFilter label="Category" value={category} onChange={(value) => updateFilter("category", value)} options={["Cycles", "Calculators", "Books", "Electronics", "Other"]} />
            <SelectFilter label="Condition" value={condition} onChange={(value) => updateFilter("condition", value)} options={["New", "Like New", "Good", "Fair", "Poor"]} />
            <label className="filter-field"><span>Min ₹</span><input aria-label="Minimum price" type="number" min="0" value={minPrice} onChange={(event) => updateFilter("minPrice", event.target.value)} placeholder="Any" /></label>
            <label className="filter-field"><span>Max ₹</span><input aria-label="Maximum price" type="number" min="0" value={maxPrice} onChange={(event) => updateFilter("maxPrice", event.target.value)} placeholder="Any" /></label>
            <SelectFilter label="Sort by" value={sort} onChange={(value) => updateFilter("sort", value)} options={["ending", "newest", "price-low", "price-high"]} display={["Ending soon", "Newest", "Price: low", "Price: high"]} />
            <label className="flex items-center gap-2 rounded-xl border border-line px-3 text-xs font-medium">
              <input type="checkbox" checked={closingSoon} onChange={(event) => updateFilter("closingSoon", event.target.checked ? "true" : "")} />
              Ends in 24h
            </label>
          </div>
        </div>
        {error && <ErrorBanner message={error} onRetry={() => void reload(page)} />}
        {loading ? <ListingSkeleton /> : items.length ? (
          <>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => <ListingCard key={item._id} item={item} />)}
            </div>
            {pages > 1 && <div className="mt-8 flex items-center justify-center gap-4">
              <button className="button-outline" disabled={page <= 1} onClick={() => void reload(page - 1)}>Previous</button>
              <span className="text-sm text-ink/60">Page {page} of {pages}</span>
              <button className="button-outline" disabled={page >= pages} onClick={() => void reload(page + 1)}>Next</button>
            </div>}
          </>
        ) : <EmptyState icon="◌" title="Nothing here just yet" message="Try a different search, or check back as more campus items are listed." />}
      </section>
    </>
  );
}

function SelectFilter({ label, value, onChange, options, display }: { label: string; value: string; onChange: (value: string) => void; options: string[]; display?: string[] }) {
  return <label className="filter-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">{label === "Sort by" ? "Ending soon" : "All"}</option>{options.map((option, index) => <option key={option} value={option}>{display?.[index] ?? option}</option>)}</select></label>;
}

function ListingCard({ item }: { item: Listing }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <article className="group overflow-hidden rounded-[26px] border border-line bg-white shadow-card transition hover:-translate-y-1 hover:shadow-lg">
      <Link to={`/listings/${item._id}`} className="block no-underline">
        <div className="relative aspect-[1.45] overflow-hidden bg-[#e8ece4]">
          {item.photos[0] ? <img src={item.photos[0]} alt={item.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" /> : <PhotoPlaceholder category={item.category} />}
          <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-forest">{item.category}</span>
          <span className="absolute bottom-4 right-4 rounded-full bg-ink/85 px-3 py-1.5 font-mono text-xs font-medium text-white" aria-label={`Time remaining: ${countdown(item.closesAt, now)}`}>◷ {countdown(item.closesAt, now)}</span>
        </div>
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <h3 className="line-clamp-1 text-lg font-bold text-ink group-hover:text-forest">{item.title}</h3>
            <span className="shrink-0 rounded-full bg-canvas px-2.5 py-1 text-[11px] font-medium text-ink/65">{item.condition}</span>
          </div>
          <div className="mt-4 flex items-end justify-between border-t border-line pt-4">
            <div><p className="text-xs text-ink/50">{item.leadingAmount == null ? "Starting bid" : "Leading bid"}</p><p className="mt-1 text-xl font-bold text-forest">{formatRupees(item.leadingAmount ?? item.startingPrice)}</p></div>
            <span className="text-sm font-semibold text-forest">View auction <span aria-hidden="true">↗</span></span>
          </div>
        </div>
      </Link>
    </article>
  );
}

function PhotoPlaceholder({ category }: { category: string }) {
  const symbols: Record<string, string> = { Cycles: "🚲", Calculators: "🧮", Books: "📚", Electronics: "🎧", Other: "✦" };
  return <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-mint to-[#f0dfc9]"><span className="text-7xl" aria-hidden="true">{symbols[category] ?? "✦"}</span></div>;
}

function ListingSkeleton() {
  return <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading auctions">
    {[0, 1, 2].map((item) => <div key={item} className="overflow-hidden rounded-[26px] border border-line bg-white"><div className="skeleton aspect-[1.45]" /><div className="space-y-3 p-5"><div className="skeleton h-5 w-3/4 rounded" /><div className="skeleton h-4 w-1/2 rounded" /><div className="skeleton mt-4 h-10 rounded" /></div></div>)}
  </div>;
}

function ListingDetail() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const isAuthenticated = Boolean(user);
  const toast = useToast();
  const [item, setItem] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bid, setBid] = useState("");
  const [now, setNow] = useState(Date.now());
  const [handover, setHandover] = useState<{ sellerConfirmedAt: string | null; buyerConfirmedAt: string | null; failedPickupAt: string | null } | null>(null);
  const [canceling, setCanceling] = useState(false);
  const load = useCallback(async () => {
    setError("");
    try {
      const response = await api<{ listing: Listing; bidHistory: Listing["bidHistory"] }>(`/listings/${id}`);
      setItem({ ...response.listing, bidHistory: response.bidHistory });
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { void load();   }, [id, load]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!id) return;
    const socket = io({ withCredentials: true, reconnection: true, autoConnect: isAuthenticated });
    socket.on("connect", () => socket.emit("auction:subscribe", id, () => void load()));
    socket.on("auction:updated", (event: { listingId?: string }) => {
      if (event.listingId === id) void load();
    });
    return () => { socket.disconnect(); };
  }, [id, isAuthenticated, load]);
  useEffect(() => {
    if (item?.saleOutcome === "Awaiting handover" && isAuthenticated) {
      void api<typeof handover>(`/listings/${id}/handover`).then(setHandover).catch((failure) => setError(messageOf(failure)));
    }
  }, [item?.saleOutcome, id, isAuthenticated]);

  const placeBid = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api(`/listings/${id}/bids`, { method: "POST", body: JSON.stringify({ amount: Number(bid) }) });
      toast("Your bid was accepted.");
      setBid("");
      await load();
    } catch (failure) {
      toast(messageOf(failure), "error");
      await load();
    }
  };

  const confirm = async () => {
    try {
      await api(`/listings/${id}/handover/confirm`, { method: "POST" });
      toast("Your handover confirmation was recorded.");
      await load();
      const result = await api<typeof handover>(`/listings/${id}/handover`);
      setHandover(result);
    } catch (failure) { toast(messageOf(failure), "error"); }
  };
  const decide = async (decision: "approve" | "reject") => {
    try {
      await api(`/listings/${id}/decision`, { method: "POST", body: JSON.stringify({ decision }) });
      toast(decision === "approve" ? "Auction approved. The item is reserved." : "Seller rejection recorded.");
      await load();
    } catch (failure) { toast(messageOf(failure), "error"); }
  };

  if (loading) return <div className="page-shell py-16"><ListingSkeleton /></div>;
  if (error || !item) return <div className="page-shell py-12"><ErrorBanner message={error || "Auction not found."} onRetry={() => void load()} /></div>;
  const isSeller = item.isSeller ?? false;
  const isWinner = item.isProvisionalWinner ?? false;
  const isOpen = item.biddingStatus === "Open" && new Date(item.closesAt).getTime() > now;
  const canCancel = isSeller
    && ["Open", "Scheduled"].includes(item.biddingStatus)
    && item.saleOutcome === "Pending seller decision"
    && new Date(item.closesAt).getTime() > now;
  const canEdit = isSeller && item.biddingStatus === "Open" && new Date(item.closesAt).getTime() > now;
  const canReviewWinningBid = isSeller
    && item.biddingStatus === "Closed"
    && item.saleOutcome === "Pending seller decision"
    && item.bidHistory.length > 0
    && item.hasProvisionalWinner === true;
  const cancel = async () => {
    if (!window.confirm("Cancel this auction? Existing bids and history will be preserved, and all bidders will be notified.")) return;
    setCanceling(true);
    try {
      const result = await api<{ listing: Listing }>(`/listings/${id}/cancel`, { method: "POST" });
      setItem((current) => current ? { ...current, ...result.listing, bidHistory: current.bidHistory } : result.listing);
      toast("Auction cancelled. Bid history was preserved.");
    } catch (failure) {
      toast(messageOf(failure), "error");
    } finally {
      setCanceling(false);
    }
  };
  return (
    <div className="page-shell py-8 md:py-12">
      <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-ink/60 hover:text-forest">← Marketplace</Link>
      <div className="grid items-start gap-8 lg:grid-cols-[1.1fr_.9fr]">
        <div>
          <div className="overflow-hidden rounded-[30px] border border-line bg-white shadow-card">
            {item.photos.length ? <img src={item.photos[0]} alt={item.title} className="aspect-[1.2] w-full object-cover" /> : <div className="aspect-[1.2]"><PhotoPlaceholder category={item.category} /></div>}
          </div>
          {item.photos.length > 1 && <div className="mt-3 grid grid-cols-4 gap-3">{item.photos.slice(1).map((photo) => <img key={photo} src={photo} alt={`${item.title} alternate view`} className="aspect-square w-full rounded-2xl border border-line object-cover" />)}</div>}
          <div className="mt-8">
            <p className="section-kicker">About this item</p>
            <p className="mt-3 whitespace-pre-wrap leading-7 text-ink/75">{item.description}</p>
            <div className="mt-5 flex flex-wrap gap-2"><Badge>{item.category}</Badge><Badge>{item.condition}</Badge><Badge>{item.biddingStatus}</Badge></div>
          </div>
          <div className="mt-8 rounded-3xl border border-line bg-white p-5">
            <h2 className="font-display text-xl">Public bid history <span className="font-sans text-sm font-normal text-ink/45">({item.bidHistory.length})</span></h2>
            {item.bidHistory.length ? <ol className="mt-4 divide-y divide-line">
              {item.bidHistory.map((entry) => <li key={entry.id} className="flex items-center justify-between gap-3 py-3">
                <div><p className="font-semibold">{entry.bidderAlias}</p><p className="text-xs text-ink/50">{formatTime(entry.createdAt)} · {entry.type} bid</p></div>
                <p className="font-bold text-forest">{formatRupees(entry.amount)}</p>
              </li>)}
            </ol> : <p className="mt-4 text-sm text-ink/55">No accepted bids yet. The first bid must be at least {formatRupees(item.startingPrice)}.</p>}
          </div>
        </div>

        <aside className="sticky top-24 rounded-[30px] border border-line bg-white p-6 shadow-card md:p-8">
          <div className="flex items-center justify-between gap-3">
            <Badge tone={isOpen ? "green" : "neutral"}>{item.biddingStatus}</Badge>
            <span className="text-sm text-ink/55">{item.condition}</span>
          </div>
          <h1 className="mt-4 font-display text-3xl leading-tight md:text-4xl">{item.title}</h1>
          <p className="mt-2 text-sm text-ink/55">Listed by {item.sellerDisplayName ?? "Campus student"}</p>
          <div className="mt-7 rounded-2xl bg-canvas p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink/50">{item.leadingAmount == null ? "Starting price" : "Current leading bid"}</p>
            <p className="mt-1 text-4xl font-black tracking-tight text-forest">{formatRupees(item.leadingAmount ?? item.startingPrice)}</p>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm">
              <div><p className="text-xs text-ink/50">Minimum next bid</p><p className="mt-1 font-bold">{formatRupees(item.minimumNextBid)}</p></div>
              <div><p className="text-xs text-ink/50">Min. increment</p><p className="mt-1 font-bold">{formatRupees(item.minimumIncrement)}</p></div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between rounded-2xl border border-line px-4 py-3">
            <span className="text-sm text-ink/60">Time remaining</span>
            <span className="font-mono font-bold text-ink">{isOpen ? countdown(item.closesAt, now) : item.biddingStatus === "Closed" ? "Auction ended" : item.biddingStatus}</span>
          </div>
          {isOpen && user && !isSeller && <form onSubmit={placeBid} className="mt-5">
            <label className="field-label" htmlFor="bid-amount">Your bid (₹)</label>
            <div className="mt-2 flex gap-2"><input id="bid-amount" className="field" type="number" step="0.01" min={item.minimumNextBid} value={bid} onChange={(event) => setBid(event.target.value)} placeholder={String(item.minimumNextBid)} required /><button className="button-primary shrink-0">Place bid</button></div>
            <p className="mt-2 text-xs text-ink/50">Bids are binding. The server verifies the minimum and closing time.</p>
          </form>}
          {isOpen && !user && <Link className="button-primary mt-5 w-full" to="/login">Log in to place a bid</Link>}
          {isSeller && isOpen && <p className="mt-4 rounded-xl bg-canvas p-3 text-sm text-ink/60">Bidding is open. The current leading bid and minimum next bid are shown above.</p>}
          {isSeller && (canEdit || canCancel) && <div className="mt-5 flex gap-2">{canEdit && item.bidHistory.length === 0 && <Link className="button-outline flex-1" to={`/listings/${id}/edit`}>Edit listing</Link>}{canCancel && <button className="button-outline flex-1" disabled={canceling} onClick={() => void cancel()}>{canceling ? "Cancelling…" : "Cancel auction"}</button>}</div>}
          {isSeller && item.bidHistory.length > 0 && <p className="mt-4 text-xs text-ink/50">Listing edits are locked after the first accepted bid. You may still cancel the auction; bid history is preserved.</p>}
          {canReviewWinningBid && <div className="mt-5 rounded-2xl border border-sun/40 bg-[#fff9f0] p-4">
            <p className="font-semibold">Review the provisional winner</p><p className="mt-1 text-sm text-ink/60">Approve to reserve the item, or reject the winning bid.</p>
            <div className="mt-4 flex gap-2"><button className="button-primary flex-1" onClick={() => void decide("approve")}>Approve Winning Bid</button><button className="button-outline flex-1" onClick={() => void decide("reject")}>Reject Winning Bid</button></div>
          </div>}
          {item.saleOutcome === "Pending seller decision" && !isSeller && <p className="mt-4 rounded-xl bg-canvas p-3 text-sm text-ink/60">This auction has closed. The seller is reviewing the leading bid.</p>}
          {item.saleOutcome === "Awaiting handover" && user && (isSeller || isWinner) && <div className="mt-5 rounded-2xl bg-mint p-4">
            <p className="font-semibold text-forest">Reserved · campus handover</p>
            <p className="mt-1 text-sm text-forest/75">Both buyer and seller confirm after meeting. Sale completes once both parties confirm.</p>
            <div className="my-3 text-xs text-forest/70">Seller: {handover?.sellerConfirmedAt ? "confirmed" : "waiting"} · Buyer: {handover?.buyerConfirmedAt ? "confirmed" : "waiting"}</div>
            {!(isSeller ? handover?.sellerConfirmedAt : handover?.buyerConfirmedAt) && <button className="button-primary w-full" onClick={() => void confirm()}>Confirm handover</button>}
            <button className="mt-3 w-full rounded-xl border border-forest/30 px-3 py-2 text-sm font-medium text-forest" onClick={async () => {
              if (!window.confirm("Record this handover as a failed pickup? This action cannot be undone.")) return;
              try { await api(`/listings/${id}/handover/failed-pickup`, { method: "POST" }); toast("Failed pickup recorded."); await load(); }
              catch (failure) { toast(messageOf(failure), "error"); }
            }}>Report failed pickup</button>
          </div>}
          {item.saleOutcome === "Completed" && <p className="mt-5 rounded-2xl bg-mint p-4 font-semibold text-forest">Sale completed · handover confirmed by both parties.</p>}
          {item.saleOutcome === "Rejected" && <p className="mt-5 rounded-2xl bg-canvas p-4 text-sm text-ink/65">The seller declined this winning bid.</p>}
          {item.saleOutcome === "Failed pickup" && <p className="mt-5 rounded-2xl bg-[#fff9f0] p-4 text-sm text-ink/65">A failed pickup was recorded. The seller can review the item before relisting.</p>}
          {item.saleOutcome === "Unsold" && <p className="mt-5 rounded-2xl bg-canvas p-4 text-sm text-ink/65">No bids were received. This item is unsold.</p>}
          {item.saleOutcome === "Cancelled" && <p className="mt-5 rounded-2xl bg-canvas p-4 text-sm text-ink/65">This auction was cancelled by the seller.</p>}
          <div className="mt-6 border-t border-line pt-5 text-xs leading-5 text-ink/50">CampusBid displays the server's accepted bids. The countdown is informational; the server decides whether a bid arrives before closing.</div>
        </aside>
      </div>
    </div>
  );
}

function createAuthSchema(registering: boolean) {
  return z.object({
    email: registering ? konguEmailSchema : normalizedEmailSchema,
    password: registering ? registrationPasswordSchema : z.string().min(1, "Enter your password.").max(128),
    displayName: z.string().trim().min(2, "Enter a display name.").max(60).optional()
  }).superRefine((values, context) => {
    if (registering && !values.displayName) {
      context.addIssue({ code: "custom", path: ["displayName"], message: "Enter a display name." });
    }
  });
}
type AuthInput = z.input<ReturnType<typeof createAuthSchema>>;

function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [verificationToken, setVerificationToken] = useState("");
  const [error, setError] = useState("");
  const registering = mode === "register";
  const form = useForm<AuthInput>({ resolver: zodResolver(createAuthSchema(registering)) });
  if (user) return <Navigate to="/dashboard" replace />;
  const submit = form.handleSubmit(async (values) => {
    setError("");
    const endpoint = registering ? "/auth/register" : "/auth/login";
    try {
      const result = await api<{ user?: User; developmentVerificationToken?: string; message?: string }>(endpoint, {
        method: "POST",
        body: JSON.stringify(values)
      });
      if (registering) {
        setVerificationToken(result.developmentVerificationToken ?? "");
        toast(result.message ?? "Registration successful.");
      } else if (result.user) {
        setUser(result.user);
        toast(`Welcome back, ${result.user.displayName}.`);
        navigate((location.state as { from?: string } | null)?.from ?? "/dashboard", { replace: true });
      }
    } catch (failure) {
      setError(messageOf(failure));
    }
  });
  const verifyDevelopment = async () => {
    try {
      const result = await api<{ user: User }>("/auth/verify", { method: "POST", body: JSON.stringify({ token: verificationToken }) });
      setUser(result.user);
      toast("Your college email is verified.");
      navigate("/dashboard", { replace: true });
    } catch (failure) { setError(messageOf(failure)); }
  };
  return <div className="page-shell grid min-h-[72vh] items-center gap-10 py-12 md:grid-cols-2">
    <div className="hidden rounded-[32px] bg-forest p-10 text-white md:block">
      <p className="section-kicker !text-mint/75">{registering ? "A better way to pass it on" : "Welcome back"}</p>
      <h1 className="mt-5 font-display text-5xl leading-tight">{registering ? "Find a new home for good things." : "Your next campus find is waiting."}</h1>
      <p className="mt-5 max-w-sm leading-7 text-white/70">Every bid is clear, every auction has its own clock, and every handover happens on campus.</p>
    </div>
    <div className="mx-auto w-full max-w-[470px]">
      <p className="section-kicker">{registering ? "Join the community" : "Student access"}</p>
      <h1 className="mt-3 font-display text-4xl">{registering ? "Create your account" : "Good to see you."}</h1>
      <p className="mt-3 text-sm leading-6 text-ink/60">{registering ? "Register with your Kongu college email address." : "Sign in to bid, manage listings, and meet your campus community."}</p>
      {error && <ErrorBanner message={error} />}
      {verificationToken ? <div className="mt-6 rounded-2xl border border-sun/40 bg-[#fff9f0] p-5">
        <p className="font-semibold">Verify your email (local development)</p>
        <p className="mt-2 text-sm leading-6 text-ink/65">Email delivery is not configured in local development. Use the one-time token shown here; production verification is sent by the configured email provider.</p>
        <label className="field-label mt-4" htmlFor="verify-token">One-time verification token</label>
        <input id="verify-token" className="field mt-2" value={verificationToken} onChange={(event) => setVerificationToken(event.target.value)} />
        <button className="button-primary mt-3 w-full" onClick={() => void verifyDevelopment()}>Verify and continue</button>
      </div> : <form noValidate onSubmit={submit} className="mt-7 space-y-4">
        {registering && <Field label="Display name" error={form.formState.errors.displayName?.message}><input className="field" autoComplete="nickname" {...form.register("displayName")} placeholder="How should others see you?" /></Field>}
        <Field label="College email" error={form.formState.errors.email?.message}><input className="field" type="email" inputMode="email" autoComplete="email" {...form.register("email")} placeholder="student@kongu.edu" /></Field>
        <Field label="Password" error={form.formState.errors.password?.message}><input className="field" type="password" autoComplete={registering ? "new-password" : "current-password"} {...form.register("password")} placeholder={registering ? "8+ chars, upper/lowercase, number, special" : "Your password"} /></Field>
        <button disabled={form.formState.isSubmitting} className="button-primary w-full !py-3.5">{form.formState.isSubmitting ? "Please wait…" : registering ? "Create account" : "Log in"}</button>
      </form>}
      <p className="mt-6 text-center text-sm text-ink/60">{registering ? "Already a member?" : "New to campusbid?"} <Link className="font-semibold text-forest underline underline-offset-4" to={registering ? "/login" : "/register"}>{registering ? "Log in" : "Create an account"}</Link></p>
    </div>
  </div>;
}

function VerifyPage() {
  const [searchParams] = useSearchParams();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const token = searchParams.get("token");
  useEffect(() => {
    if (!token) return;
    void api<{ user: User }>("/auth/verify", { method: "POST", body: JSON.stringify({ token }) })
      .then((result) => { setUser(result.user); setDone(true); toast("Email verified."); })
      .catch((failure) => setError(messageOf(failure)));
  }, [token, setUser, toast]);
  return <div className="page-shell max-w-xl py-20 text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-mint text-3xl text-forest">✓</div><h1 className="mt-6 font-display text-4xl">Email verification</h1>{error ? <p className="mt-4 text-red-700">{error}</p> : <p className="mt-4 text-ink/60">{done ? "Your account is ready." : token ? "Checking your one-time link…" : "Open the verification link from your college email."}</p>}{done && <button className="button-primary mt-6" onClick={() => navigate("/dashboard")}>Continue to dashboard</button>}</div>;
}

const listingFormSchema = z.object({
  title: z.string().trim().min(3).max(100),
  category: z.enum(["Cycles", "Calculators", "Books", "Electronics", "Other"]),
  condition: z.enum(["New", "Like New", "Good", "Fair", "Poor"]),
  description: z.string().trim().min(10).max(4000),
  startingPrice: z.number().positive(),
  minimumIncrement: z.number().positive(),
  closesAt: z.string().min(1)
});
type ListingFormInput = z.infer<typeof listingFormSchema>;

function ListingForm({ edit = false }: { edit?: boolean }) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [item, setItem] = useState<Listing | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [pendingPhotoPreviews, setPendingPhotoPreviews] = useState<Array<{ key: string; src: string; name: string }>>([]);
  const [photoError, setPhotoError] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [draggingPhotos, setDraggingPhotos] = useState(false);
  const uploadedPhotoKeys = useRef(new Map<string, string>());
  const uploadingPhotos = useRef(false);
  const pendingPhotoKeys = useRef(new Set<string>());
  const removedPhotoKeys = useRef(new Set<string>());
  const form = useForm<ListingFormInput>({
    resolver: zodResolver(listingFormSchema),
    defaultValues: { category: "Other", condition: "Good", startingPrice: 100, minimumIncrement: 10 }
  });
  const resetForm = form.reset;
  useEffect(() => {
    if (!edit) return;
    void api<{ listing: Listing }>(`/listings/${id}`).then(({ listing }) => {
      setItem(listing);
      setPhotos(listing.photos);
      resetForm({
        title: listing.title,
        category: listing.category,
        condition: listing.condition,
        description: listing.description,
        startingPrice: listing.startingPrice,
        minimumIncrement: listing.minimumIncrement,
        closesAt: toLocalDateTime(listing.closesAt)
      });
    }).catch((failure) => setError(messageOf(failure)));
  }, [edit, id, resetForm]);

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length || uploadingPhotos.current) return;
    setPhotoError("");
    const pending: Array<{ file: File; key: string }> = [];
    const seen = new Set([...uploadedPhotoKeys.current.values(), ...pendingPhotoKeys.current]);
    const errors: string[] = [];
    let remaining = 5 - photos.length;
    for (const file of Array.from(files)) {
      const key = `${file.name.toLowerCase()}:${file.size}:${file.lastModified}:${file.type}`;
      if (seen.has(key)) continue;
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        errors.push(`${file.name}: use a JPEG, PNG, or WebP image.`);
        continue;
      }
      if (file.size > 5 * 1024 * 1024) {
        errors.push(`${file.name}: images must be 5 MB or smaller.`);
        continue;
      }
      if (remaining <= 0) {
        errors.push("Choose up to five photos.");
        break;
      }
      pending.push({ file, key });
      seen.add(key);
      remaining -= 1;
    }
    if (!pending.length) {
      if (errors.length) setPhotoError(errors.join(" "));
      return;
    }
    uploadingPhotos.current = true;
    for (const { key } of pending) pendingPhotoKeys.current.add(key);
    setPendingPhotoPreviews((current) => [
      ...current,
      ...pending.map(({ file, key }) => ({ key, src: URL.createObjectURL(file), name: file.name }))
    ]);
    setUploading(true);
    try {
      for (const { file, key } of pending) {
        const data = new FormData();
        data.set("photo", file);
        try {
          const result = await api<{ url: string }>("/uploads", { method: "POST", body: data });
          if (!removedPhotoKeys.current.has(key)) {
            uploadedPhotoKeys.current.set(result.url, key);
            setPhotos((current) => current.includes(result.url) ? current : [...current, result.url]);
          }
        } catch (failure) {
          errors.push(`${file.name}: ${messageOf(failure)}`);
        }
      }
      if (errors.length) setPhotoError(errors.join(" "));
    }
    finally {
      for (const { key } of pending) {
        pendingPhotoKeys.current.delete(key);
        removedPhotoKeys.current.delete(key);
      }
      setPendingPhotoPreviews((current) => {
        for (const preview of current) {
          if (pending.some(({ key }) => key === preview.key)) URL.revokeObjectURL(preview.src);
        }
        return current.filter((preview) => !pending.some(({ key }) => key === preview.key));
      });
      setUploading(false);
    }
    uploadingPhotos.current = false;
  };

  const submit = form.handleSubmit(async (values) => {
    setError("");
    setPhotoError("");
    if (!photos.length) { setPhotoError("Add at least one item photo."); return; }
    const parsed = listingFormSchema.safeParse(values);
    if (!parsed.success) { setError("Check the highlighted fields."); return; }
    const body = {
      ...values,
      startingPrice: Number(values.startingPrice),
      minimumIncrement: Number(values.minimumIncrement),
      closesAt: new Date(values.closesAt).toISOString(),
      photos
    };
    try {
      if (edit) await api(`/listings/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      else await api("/listings", { method: "POST", body: JSON.stringify(body) });
      toast(edit ? "Your listing was updated." : "Your auction is live.");
      navigate(edit ? `/listings/${id}` : "/my-listings");
    } catch (failure) { setError(messageOf(failure)); }
  });

  if (edit && !item && !error) return <div className="page-shell py-16"><ListingSkeleton /></div>;
  return <div className="page-shell max-w-3xl py-10 md:py-14">
    <Link to={edit ? `/listings/${id}` : "/dashboard"} className="text-sm text-ink/55 hover:text-forest">← {edit ? "Auction details" : "Dashboard"}</Link>
    <p className="section-kicker mt-6">{edit ? "Your auction" : "Pass it on"}</p>
    <h1 className="mt-2 font-display text-4xl">{edit ? "Edit your listing" : "List something useful."}</h1>
    <p className="mt-3 text-sm text-ink/60">Set clear terms. Once a bid is placed, auction-defining details can no longer be changed.</p>
    {error && <ErrorBanner message={error} />}
    <form onSubmit={submit} className="mt-8 space-y-6 rounded-[28px] border border-line bg-white p-5 shadow-card sm:p-8">
      <Field label="Item title" error={form.formState.errors.title?.message}><input className="field" {...form.register("title")} placeholder="e.g. Casio scientific calculator" /></Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Category" error={form.formState.errors.category?.message}><select className="field" {...form.register("category")}><option>Cycles</option><option>Calculators</option><option>Books</option><option>Electronics</option><option>Other</option></select></Field>
        <Field label="Condition" error={form.formState.errors.condition?.message}><select className="field" {...form.register("condition")}><option>New</option><option>Like New</option><option>Good</option><option>Fair</option><option>Poor</option></select></Field>
      </div>
      <Field label="Description" error={form.formState.errors.description?.message}><textarea className="field min-h-32 resize-y" {...form.register("description")} placeholder="Describe the item honestly: age, use, condition, and what's included." /></Field>
      <div>
        <div className="flex items-end justify-between gap-3"><label className="field-label">Item photos <span className="font-normal text-ink/45">· up to 5</span></label><span className="text-xs text-ink/45">{photos.length}/5</span></div>
        <div
          role="region"
          aria-label="Photo upload area"
          onDragEnter={(event) => { event.preventDefault(); setDraggingPhotos(true); }}
          onDragOver={(event) => { event.preventDefault(); setDraggingPhotos(true); }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingPhotos(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDraggingPhotos(false);
            void addPhotos(event.dataTransfer.files);
          }}
          className={`mt-2 rounded-2xl border border-dashed px-4 py-7 text-center transition-colors ${draggingPhotos ? "border-forest bg-mint/50 ring-2 ring-forest/20" : "border-line bg-canvas"}`}
        >
          <label className="flex cursor-pointer flex-col items-center justify-center">
            <span className="text-2xl" aria-hidden="true">↥</span><span className="mt-2 text-sm font-semibold">Drop photos here or choose photos</span><span className="mt-1 text-xs text-ink/50">JPEG, PNG, or WebP · 5 MB max each</span>
            <input aria-label="Choose item photos" className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={uploading || photos.length >= 5} onChange={(event) => { void addPhotos(event.target.files); event.target.value = ""; }} />
          </label>
        </div>
        {photoError && <p role="alert" className="mt-2 text-sm text-red-700">{photoError}</p>}
        {uploading && <p className="mt-2 text-sm text-ink/60">Uploading photos…</p>}
        {(photos.length > 0 || pendingPhotoPreviews.length > 0) && <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5">
          {photos.map((photo) => <div key={photo} className="relative overflow-hidden rounded-xl border border-line"><img className="aspect-square w-full object-cover" src={photo} alt="Auction item preview" /><button className="absolute right-1 top-1 rounded-full bg-white px-2 py-1 text-xs shadow" type="button" aria-label="Remove photo" onClick={() => { uploadedPhotoKeys.current.delete(photo); setPhotos((current) => current.filter((value) => value !== photo)); }}>×</button></div>)}
          {pendingPhotoPreviews.map((preview) => <div key={preview.key} className="relative overflow-hidden rounded-xl border border-line"><img className="aspect-square w-full object-cover" src={preview.src} alt={`${preview.name} preview`} /><button className="absolute right-1 top-1 rounded-full bg-white px-2 py-1 text-xs shadow" type="button" aria-label={`Remove ${preview.name}`} onClick={() => { removedPhotoKeys.current.add(preview.key); pendingPhotoKeys.current.delete(preview.key); URL.revokeObjectURL(preview.src); setPendingPhotoPreviews((current) => current.filter((value) => value.key !== preview.key)); }}>×</button></div>)}
        </div>}
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Starting price (₹)" error={form.formState.errors.startingPrice?.message}><input className="field" type="number" min="0.01" step="0.01" {...form.register("startingPrice", { valueAsNumber: true })} /></Field>
        <Field label="Minimum increment (₹)" error={form.formState.errors.minimumIncrement?.message}><input className="field" type="number" min="0.01" step="0.01" {...form.register("minimumIncrement", { valueAsNumber: true })} /></Field>
      </div>
      <Field label="Auction closes" error={form.formState.errors.closesAt?.message}><input className="field" type="datetime-local" min={minDateTime()} {...form.register("closesAt")} /></Field>
      <div className="rounded-2xl bg-[#fff9f0] p-4 text-sm leading-6 text-ink/70"><strong className="text-ink">Auction rule:</strong> your first bid must meet the starting price; each later manual bid must beat the leading bid by at least the minimum increment.</div>
      <button className="button-primary w-full !py-3.5" disabled={form.formState.isSubmitting || uploading}>{form.formState.isSubmitting ? "Saving…" : edit ? "Save listing" : "Publish auction"}</button>
    </form>
  </div>;
}

function Dashboard() {
  const { user } = useAuth();
  return <div className="page-shell py-10 md:py-14">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="section-kicker">Your campus account</p><h1 className="mt-2 font-display text-4xl">Hey, {user?.displayName.split(" ")[0]}.</h1><p className="mt-2 text-sm text-ink/60">Your buying and selling, all in one place.</p></div><Link to="/listings/new" className="button-primary">＋ List an item</Link></div>
    <div className="mt-8 grid gap-4 sm:grid-cols-3">
      <DashboardTile icon="↗" title="My listings" text="Manage your auctions and sale outcomes." to="/my-listings" />
      <DashboardTile icon="⌁" title="My bids" text="Follow the auctions you've bid on." to="/my-bids" />
      <DashboardTile icon="◉" title="Notifications" text="Stay up to date on bids and handovers." to="/notifications" />
    </div>
    <div className="mt-8 rounded-3xl border border-line bg-white p-6">
      <h2 className="font-display text-2xl">One account, both sides.</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/60">Bid on things you need. List things someone else can use. CampusBid keeps every auction and handover attached to the same student account.</p>
      <Link to="/" className="mt-5 inline-flex font-semibold text-forest">Explore live auctions <span className="ml-2">↗</span></Link>
    </div>
  </div>;
}

function DashboardTile({ icon, title, text, to }: { icon: string; title: string; text: string; to: string }) {
  return <Link to={to} className="rounded-3xl border border-line bg-white p-6 shadow-card transition hover:-translate-y-0.5 hover:border-forest/30">
    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-mint text-xl text-forest">{icon}</span><h2 className="mt-5 text-xl font-bold">{title}</h2><p className="mt-2 text-sm leading-6 text-ink/55">{text}</p><span className="mt-5 inline-block text-sm font-semibold text-forest">Open <span aria-hidden="true">↗</span></span>
  </Link>;
}

function MyListings() {
  const [items, setItems] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    void api<{ items: Listing[] }>("/listings/mine").then((result) => setItems(result.items)).catch((failure) => setError(messageOf(failure))).finally(() => setLoading(false));
  }, []);
  return <div className="page-shell py-10 md:py-14">
    <div className="flex items-end justify-between gap-4"><div><p className="section-kicker">Seller workspace</p><h1 className="mt-2 font-display text-4xl">My listings</h1></div><Link to="/listings/new" className="button-primary">＋ New auction</Link></div>
    {error && <ErrorBanner message={error} />}
    {loading ? <ListingSkeleton /> : items.length ? <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{items.map((item) => <ListingCard key={item._id} item={item} />)}</div> : <EmptyState icon="↗" title="No listings yet" message="List an item you no longer need and let another student find it." action={<Link className="button-primary" to="/listings/new">Create your first auction</Link>} />}
  </div>;
}

function MyBids() {
  const [rows, setRows] = useState<Array<{ id: string; listingId: string; listingTitle: string; amount: number; createdAt: string }>>([]);
  const [listings, setListings] = useState<Record<string, Listing>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void api<{ bids: typeof rows; listings: Listing[] }>("/dashboard").then((result) => {
      setRows(result.bids);
      setListings(Object.fromEntries(result.listings.map((item) => [item._id, item])));
    }).catch((failure) => setError(messageOf(failure))).finally(() => setLoading(false));
  }, []);
  return <div className="page-shell py-10 md:py-14"><p className="section-kicker">Buyer workspace</p><h1 className="mt-2 font-display text-4xl">My bids</h1>{error && <ErrorBanner message={error} />}
    {loading ? <div className="mt-8 space-y-3"><div className="skeleton h-20 rounded-2xl" /><div className="skeleton h-20 rounded-2xl" /></div> : rows.length ?     <div className="mt-8 space-y-3">{rows.map((bid) => <Link key={bid.id} to={`/listings/${bid.listingId}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white p-5 no-underline shadow-card"><div><p className="font-semibold">{bid.listingTitle || listings[bid.listingId]?.title || "Campus auction"}</p><p className="mt-1 text-sm text-ink/50">Bid placed {formatTime(bid.createdAt)}</p></div><p className="font-bold text-forest">{formatRupees(bid.amount)}</p></Link>)}</div> : <EmptyState icon="⌁" title="No bids yet" message="Find something you like and place a fair, transparent bid." action={<Link to="/" className="button-primary">Explore auctions</Link>} />}
  </div>;
}

type NotificationItem = { id: string; listingId: string | null; type: string; message: string; read: boolean; createdAt: string };
function Notifications() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = () => api<{ items: NotificationItem[] }>("/notifications").then((result) => setItems(result.items)).catch((failure) => setError(messageOf(failure))).finally(() => setLoading(false));
  useEffect(() => { void load(); }, []);
  const markRead = async (id: string) => {
    try {
      await api(`/notifications/${id}/read`, { method: "POST" });
      setItems((current) => current.map((item) => item.id === id ? { ...item, read: true } : item));
    } catch (failure) { setError(messageOf(failure)); }
  };
  return <div className="page-shell max-w-3xl py-10 md:py-14">
    <div className="flex items-end justify-between gap-4"><div><p className="section-kicker">Your updates</p><h1 className="mt-2 font-display text-4xl">Notifications</h1></div>{items.some((item) => !item.read) && <span className="rounded-full bg-mint px-3 py-1 text-xs font-semibold text-forest">{items.filter((item) => !item.read).length} unread</span>}</div>
    {error && <ErrorBanner message={error} onRetry={() => void load()} />}
    {loading ? <div className="mt-8 space-y-3"><div className="skeleton h-24 rounded-2xl" /><div className="skeleton h-24 rounded-2xl" /></div> : items.length ? <div className="mt-8 space-y-3">{items.map((item) => <div key={item.id} className={`rounded-2xl border p-5 ${item.read ? "border-line bg-white" : "border-forest/20 bg-mint/50"}`}><div className="flex items-start justify-between gap-3"><div><p className="leading-6">{item.message}</p><p className="mt-2 text-xs text-ink/50">{formatTime(item.createdAt)}</p></div>{!item.read && <button className="shrink-0 text-xs font-semibold text-forest underline" onClick={() => void markRead(item.id)}>Mark read</button>}</div>{item.listingId && <Link className="mt-3 inline-block text-sm font-semibold text-forest" to={`/listings/${item.listingId}`}>View auction ↗</Link>}</div>)}</div> : <EmptyState icon="◉" title="You're all caught up" message="When something happens on your auctions, you'll find it here." />}
  </div>;
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return <div><label className="field-label">{label}<span className="mt-2 block font-normal">{children}</span></label>{error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}</div>;
}

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" }) {
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${tone === "green" ? "bg-mint text-forest" : "bg-canvas text-ink/65"}`}>{children}</span>;
}

function EmptyState({ icon, title, message, action }: { icon: string; title: string; message: string; action?: ReactNode }) {
  return <div className="mt-8 rounded-[28px] border border-dashed border-line bg-white/65 px-6 py-14 text-center"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-mint text-2xl text-forest">{icon}</span><h2 className="mt-4 font-display text-2xl">{title}</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-ink/55">{message}</p>{action && <div className="mt-5">{action}</div>}</div>;
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div role="alert" className="my-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><span>{message}</span>{onRetry && <button className="font-semibold underline" onClick={onRetry}>Try again</button>}</div>;
}

function NotFound() {
  return <div className="page-shell py-24 text-center"><p className="section-kicker">404 · not found</p><h1 className="mt-3 font-display text-4xl">This page took a detour.</h1><Link className="button-primary mt-6" to="/">Back to marketplace</Link></div>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function initials(displayName: string): string {
  return displayName.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function toLocalDateTime(value: string): string {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function minDateTime(): string {
  return toLocalDateTime(new Date(Date.now() + 60_000).toISOString());
}

export default App;
