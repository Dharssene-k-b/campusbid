import { randomBytes, createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import session from "express-session";
import MongoStore from "connect-mongo";
import bcrypt from "bcryptjs";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { fileTypeFromBuffer } from "file-type";
import nodemailer from "nodemailer";
import { v2 as cloudinary } from "cloudinary";
import { Types } from "mongoose";
import { z } from "zod";
import { konguEmailSchema, normalizedEmailSchema, registrationPasswordSchema } from "../../../shared/registration-validation.js";
import { config } from "./config.js";
import { Handover, Listing, Notification, PhotoAsset, User, toPaise, toRupees } from "./models.js";
import { closeExpiredAuctions, confirmHandover, decideSale, makeNotification, markFailedPickup } from "./auction.js";

declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}

const uploadsDirectory = path.resolve(process.cwd(), "uploads");
const allowedPhotoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
if (config.IMAGE_STORAGE_PROVIDER === "cloudinary") {
  cloudinary.config({
    cloud_name: config.CLOUDINARY_CLOUD_NAME,
    api_key: config.CLOUDINARY_API_KEY,
    api_secret: config.CLOUDINARY_API_SECRET,
    secure: true
  });
}
const sessionMiddleware = session({
  name: "campusbid.sid",
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: config.MONGODB_URI, collectionName: "sessions", ttl: 60 * 60 * 24 * 7 }),
  cookie: {
    httpOnly: true,
    secure: config.secureCookie,
    sameSite: config.COOKIE_SAME_SITE,
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
});

export type AppServices = {
  now: () => Date;
  emitAuctionUpdate: (listingId: string) => void;
};

const defaultServices: AppServices = { now: () => new Date(), emitAuctionUpdate: () => undefined };

async function deliverVerificationEmail(email: string, token: string): Promise<void> {
  if (config.EMAIL_PROVIDER === "development") return;
  const transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000
  });
  const link = `${config.FRONTEND_URL}/verify?token=${encodeURIComponent(token)}`;
  await transporter.sendMail({
    from: config.EMAIL_FROM,
    to: email,
    subject: "Verify your CampusBid student account",
    text: `Use this one-time link to verify your college email address. It expires in 24 hours:\n\n${link}\n\nIf you did not create a CampusBid account, you can ignore this message.`
  });
}

function publicUser(user: { _id: Types.ObjectId; email: string; displayName: string; verifiedAt: Date | null }) {
  return { id: user._id.toString(), email: user.email, displayName: user.displayName, verified: Boolean(user.verifiedAt) };
}

function safeListing(listing: Record<string, unknown> & { _id: Types.ObjectId; sellerId: Types.ObjectId; leadingBidderId?: Types.ObjectId | null; startingPricePaise: number; minimumIncrementPaise: number; leadingAmountPaise?: number | null; bidHistory?: Array<Record<string, unknown>> }) {
  const rest = Object.fromEntries(
    Object.entries(listing).filter(([key]) => ![
      "sellerId",
      "leadingBidderId",
      "leadingBidId",
      "provisionalWinnerId",
      "cancellationActorId",
      "startingPricePaise",
      "minimumIncrementPaise",
      "leadingAmountPaise",
      "bidHistory"
    ].includes(key))
  );
  const { startingPricePaise, minimumIncrementPaise, leadingAmountPaise, bidHistory } = listing;
  return {
    ...rest,
    startingPrice: toRupees(startingPricePaise),
    minimumIncrement: toRupees(minimumIncrementPaise),
    leadingAmount: toRupees(leadingAmountPaise),
    minimumNextBid: toRupees(leadingAmountPaise == null ? startingPricePaise : leadingAmountPaise + minimumIncrementPaise),
    bidHistory: (bidHistory ?? []).map((bid) => ({
      id: String(bid.bidId),
      bidderAlias: bid.bidderAlias,
      amount: toRupees(Number(bid.amountPaise)),
      type: bid.type,
      createdAt: bid.createdAt
    }))
  };
}

function asyncRoute(handler: (req: Request, res: Response, next: NextFunction, services: AppServices) => Promise<unknown>, services: AppServices) {
  return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res, next, services)).catch(next);
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId || !Types.ObjectId.isValid(req.session.userId)) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  next();
}

function requireVerified(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  void User.exists({ _id: req.session.userId, verifiedAt: { $ne: null }, accountStatus: "active" })
    .then((exists) => exists ? next() : res.status(403).json({ error: "Verify your college email before continuing." }))
    .catch(next);
}

function getRouteId(req: Request): string {
  const value = req.params.id;
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

const registrationSchema = z.object({
  email: konguEmailSchema,
  password: registrationPasswordSchema,
  displayName: z.string().trim().min(2).max(60)
});
const listingSchema = z.object({
  title: z.string().trim().min(3).max(100),
  category: z.enum(["Cycles", "Calculators", "Books", "Electronics", "Other"]),
  description: z.string().trim().min(10).max(4000),
  condition: z.enum(["New", "Like New", "Good", "Fair", "Poor"]),
  photos: z.array(z.string().refine((value) => {
    if (/^\/(?:api\/)?uploads\/[a-zA-Z0-9._-]+$/.test(value)) return true;
    try { return new URL(value).protocol === "https:"; } catch { return false; }
  }, "Photo must be an uploaded local or secure hosted image.")).min(1).max(5),
  startingPrice: z.number().finite().positive().max(1_000_000),
  minimumIncrement: z.number().finite().positive().max(100_000),
  closesAt: z.string().datetime()
});

export function createApp(services: AppServices = defaultServices) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cors({ origin: config.FRONTEND_URL, credentials: true, methods: ["GET", "POST", "PATCH", "DELETE"] }));
  app.use((req, res, next) => {
    const origin = req.get("origin");
    if (origin && origin !== config.FRONTEND_URL && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      res.status(403).json({ error: "Request origin is not allowed." });
      return;
    }
    next();
  });
  app.use(express.json({ limit: "32kb" }));
  app.use(sessionMiddleware);
  app.use("/uploads", express.static(uploadsDirectory, { dotfiles: "deny", index: false, maxAge: "1h" }));
  app.use("/api/uploads", express.static(uploadsDirectory, { dotfiles: "deny", index: false, maxAge: "1h" }));
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: () => config.NODE_ENV === "test",
    message: { error: "Too many authentication attempts. Try again later." }
  });
  app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 240, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many requests. Try again shortly." } }));
  app.use("/api/auth", authLimiter);

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

  app.post("/api/auth/register", asyncRoute(async (req, res) => {
    const parsed = registrationSchema.safeParse(req.body);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((issue) => ({
        field: String(issue.path[0] ?? "form"),
        message: issue.message
      }));
      return res.status(400).json({ error: "Invalid registration details.", fields });
    }
    const { email, password, displayName } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 12);
    const rawToken = randomBytes(32).toString("base64url");
    const verificationTokenHash = createHash("sha256").update(rawToken).digest("hex");
    try {
      await User.create({
        email,
        passwordHash,
        displayName,
        verificationTokenHash,
        verificationExpiresAt: new Date(services.now().getTime() + 24 * 60 * 60 * 1000)
      });
      try {
        await deliverVerificationEmail(email, rawToken);
      } catch {
        return res.status(503).json({ error: "Account created, but the verification email could not be sent. Request a new verification link shortly." });
      }
      const response: Record<string, unknown> = { message: "Registration successful. Verify your college email to activate bidding." };
      if (config.NODE_ENV !== "production") response.developmentVerificationToken = rawToken;
      return res.status(201).json(response);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) return res.status(409).json({ error: "An account with this email already exists." });
      throw error;
    }
  }, services));

  app.post("/api/auth/verify", asyncRoute(async (req, res) => {
    const token = z.string().min(32).max(128).safeParse(req.body?.token);
    if (!token.success) return res.status(400).json({ error: "A valid verification token is required." });
    const verificationTokenHash = createHash("sha256").update(token.data).digest("hex");
    const user = await User.findOneAndUpdate(
      { verificationTokenHash, verificationExpiresAt: { $gt: services.now() }, verifiedAt: null },
      { $set: { verifiedAt: services.now() }, $unset: { verificationTokenHash: 1, verificationExpiresAt: 1 } },
      { new: true }
    );
    if (!user) return res.status(400).json({ error: "This verification link is invalid or has expired." });
    await new Promise<void>((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
    req.session.userId = user.id;
    return res.json({ user: publicUser(user) });
  }, services));

  app.post("/api/auth/resend-verification", asyncRoute(async (req, res) => {
    const input = z.object({ email: normalizedEmailSchema }).safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: "Enter a valid email address." });
    const response = { message: "If an unverified account exists for that address, a new verification link has been sent." };
    const user = await User.findOne({ email: input.data.email.toLowerCase(), verifiedAt: null }).select("+verificationTokenHash +verificationExpiresAt");
    if (!user || !konguEmailSchema.safeParse(user.email).success) return res.json(response);
    const rawToken = randomBytes(32).toString("base64url");
    user.verificationTokenHash = createHash("sha256").update(rawToken).digest("hex");
    user.verificationExpiresAt = new Date(services.now().getTime() + 24 * 60 * 60 * 1000);
    await user.save();
    try {
      await deliverVerificationEmail(user.email, rawToken);
    } catch {
      return res.status(503).json({ error: "Verification email could not be sent. Check the email provider configuration and try again." });
    }
    if (config.NODE_ENV !== "production") return res.json({ ...response, developmentVerificationToken: rawToken });
    return res.json(response);
  }, services));

  app.post("/api/auth/login", asyncRoute(async (req, res) => {
    const input = z.object({ email: normalizedEmailSchema, password: z.string().min(1).max(128) }).safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: "Email and password are required." });
    const user = await User.findOne({ email: input.data.email, accountStatus: "active" }).select("+passwordHash");
    if (!user || !(await bcrypt.compare(input.data.password, user.passwordHash))) return res.status(401).json({ error: "Email or password is incorrect." });
    if (!user.verifiedAt) return res.status(403).json({ error: "Verify your college email before logging in." });
    await new Promise<void>((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
    req.session.userId = user.id;
    return res.json({ user: publicUser(user) });
  }, services));

  app.post("/api/auth/logout", requireAuth, asyncRoute(async (req, res) => {
    await new Promise<void>((resolve, reject) => req.session.destroy((error) => error ? reject(error) : resolve()));
    res.clearCookie("campusbid.sid", { httpOnly: true, secure: config.secureCookie, sameSite: config.COOKIE_SAME_SITE });
    return res.status(204).end();
  }, services));

  app.get("/api/auth/me", asyncRoute(async (req, res) => {
    if (!req.session.userId || !Types.ObjectId.isValid(req.session.userId)) return res.json({ user: null });
    const user = await User.findById(req.session.userId).select("email displayName verifiedAt");
    if (!user) return res.json({ user: null });
    return res.json({ user: publicUser(user) });
  }, services));

  app.post("/api/uploads", requireVerified, uploadMiddleware().single("photo"), asyncRoute(async (req, res) => {
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) return res.status(400).json({ error: "Choose an image file." });
    if (!allowedPhotoTypes.has(file.mimetype)) {
      return res.status(400).json({ error: "Only JPEG, PNG, or WebP images are accepted." });
    }
    const detected = await fileTypeFromBuffer(file.buffer);
    if (!detected || !allowedPhotoTypes.has(detected.mime)) {
      return res.status(400).json({ error: "Only valid JPEG, PNG, or WebP images are accepted." });
    }
    let url: string;
    if (config.IMAGE_STORAGE_PROVIDER === "cloudinary") {
      const upload = await new Promise<{ secure_url: string }>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "campusbid/items", resource_type: "image", allowed_formats: ["jpg", "jpeg", "png", "webp"] },
          (error, result) => {
            if (error || !result) reject(error ?? new Error("Image storage returned no result."));
            else resolve(result);
          }
        );
        stream.end(file.buffer);
      });
      url = upload.secure_url;
    } else {
      await fs.mkdir(uploadsDirectory, { recursive: true });
      const name = `${randomBytes(18).toString("hex")}.${detected.ext}`;
      await fs.writeFile(path.join(uploadsDirectory, name), file.buffer, { flag: "wx" });
      url = `/api/uploads/${name}`;
    }
    await PhotoAsset.create({ ownerId: req.session.userId, url, mimeType: detected.mime });
    return res.status(201).json({ url });
  }, services));

  app.get("/api/listings", asyncRoute(async (req, res) => {
    const query = z.object({
      q: z.string().trim().max(100).optional(),
      category: z.enum(["Cycles", "Calculators", "Books", "Electronics", "Other"]).optional(),
      condition: z.enum(["New", "Like New", "Good", "Fair", "Poor"]).optional(),
      minPrice: z.coerce.number().min(0).optional(),
      maxPrice: z.coerce.number().min(0).optional(),
      closingSoon: z.enum(["true", "false"]).optional(),
      sort: z.enum(["ending", "newest", "price-low", "price-high"]).default("ending"),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(48).default(12)
    }).safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Invalid marketplace filters.", details: query.error.issues });
    const filters = query.data;
    if (filters.minPrice !== undefined && filters.maxPrice !== undefined && filters.minPrice > filters.maxPrice) {
      return res.status(400).json({ error: "Minimum price cannot exceed maximum price." });
    }
    const selector: Record<string, unknown> = { biddingStatus: "Open", closesAt: { $gt: services.now() } };
    if (filters.q) selector.$text = { $search: filters.q };
    if (filters.category) selector.category = filters.category;
    if (filters.condition) selector.condition = filters.condition;
    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      const bounds = [];
      if (filters.minPrice !== undefined) bounds.push({ $gte: [{ $ifNull: ["$leadingAmountPaise", "$startingPricePaise"] }, toPaise(filters.minPrice)] });
      if (filters.maxPrice !== undefined) bounds.push({ $lte: [{ $ifNull: ["$leadingAmountPaise", "$startingPricePaise"] }, toPaise(filters.maxPrice)] });
      selector.$expr = { $and: bounds };
    }
    if (filters.closingSoon === "true") selector.closesAt = { $gt: services.now(), $lte: new Date(services.now().getTime() + 24 * 60 * 60 * 1000) };
    const sort: Record<string, 1 | -1> = filters.sort === "newest" ? { createdAt: -1 } : filters.sort === "price-low" ? { startingPricePaise: 1 } : filters.sort === "price-high" ? { startingPricePaise: -1 } : { closesAt: 1 };
    const [results, total] = await Promise.all([
      Listing.find(selector).sort(sort).skip((filters.page - 1) * filters.limit).limit(filters.limit).lean(),
      Listing.countDocuments(selector)
    ]);
    return res.json({ items: results.map((item) => safeListing(item as never)), page: filters.page, limit: filters.limit, total, pages: Math.ceil(total / filters.limit) });
  }, services));

  app.get("/api/listings/mine", requireAuth, asyncRoute(async (req, res) => {
    const listings = await Listing.find({ sellerId: req.session.userId }).sort({ createdAt: -1 }).lean();
    return res.json({ items: listings.map((item) => safeListing(item as never)) });
  }, services));

  app.post("/api/listings", requireVerified, asyncRoute(async (req, res) => {
    const parsed = listingSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid listing details.", details: parsed.error.issues });
    const input = parsed.data;
    const closesAt = new Date(input.closesAt);
    if (closesAt <= services.now()) return res.status(400).json({ error: "Closing time must be in the future." });
    const photosOwned = await PhotoAsset.countDocuments({ ownerId: req.session.userId, url: { $in: input.photos } });
    if (photosOwned !== new Set(input.photos).size) return res.status(400).json({ error: "One or more photos were not uploaded by your account." });
    const listing = await Listing.create({
      sellerId: req.session.userId,
      ...input,
      startingPricePaise: toPaise(input.startingPrice),
      minimumIncrementPaise: toPaise(input.minimumIncrement),
      closesAt,
      biddingStatus: "Open",
      saleOutcome: "Pending seller decision"
    });
    return res.status(201).json({ listing: safeListing(listing.toObject() as never) });
  }, services));

  app.get("/api/listings/:id", asyncRoute(async (req, res) => {
    const id = getRouteId(req);
    if (!Types.ObjectId.isValid(id)) return res.status(404).json({ error: "Auction not found." });
    await closeExpiredAuctions(services.now(), services.emitAuctionUpdate, id);
    const listing = await Listing.findById(id).lean();
    if (!listing) return res.status(404).json({ error: "Auction not found." });
    const seller = await User.findById(listing.sellerId).select("displayName").lean();
    return res.json({
      listing: {
        ...safeListing(listing as never),
        sellerDisplayName: seller?.displayName ?? "Campus student",
        isSeller: Boolean(req.session.userId && listing.sellerId.toString() === req.session.userId),
        isProvisionalWinner: Boolean(req.session.userId && listing.provisionalWinnerId?.toString() === req.session.userId),
        hasProvisionalWinner: Boolean(listing.provisionalWinnerId)
      },
      bidHistory: [...(listing.bidHistory ?? [])].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((bid) => ({
        id: bid.bidId.toString(),
        bidderAlias: bid.bidderAlias,
        amount: toRupees(bid.amountPaise),
        type: bid.type,
        createdAt: bid.createdAt
      }))
    });
  }, services));

  app.patch("/api/listings/:id", requireVerified, asyncRoute(async (req, res) => {
    const id = getRouteId(req);
    if (!Types.ObjectId.isValid(id)) return res.status(404).json({ error: "Auction not found." });
    const parsed = listingSchema.partial().safeParse(req.body);
    if (!parsed.success || !Object.keys(parsed.data ?? {}).length) return res.status(400).json({ error: "Provide valid listing fields to update.", details: parsed.success ? undefined : parsed.error.issues });
    const listing = await Listing.findOne({ _id: id, sellerId: req.session.userId });
    if (!listing) return res.status(404).json({ error: "Auction not found." });
    if (listing.biddingStatus !== "Open" || listing.closesAt <= services.now()) return res.status(409).json({ error: "Only an open auction can be edited." });
    if (listing.bidHistory.length && ("startingPrice" in parsed.data || "minimumIncrement" in parsed.data || "closesAt" in parsed.data || "category" in parsed.data || "condition" in parsed.data || "title" in parsed.data)) {
      return res.status(409).json({ error: "Auction terms cannot be materially changed after a bid is placed." });
    }
    if (parsed.data.photos) {
      const photosOwned = await PhotoAsset.countDocuments({ ownerId: req.session.userId, url: { $in: parsed.data.photos } });
      if (photosOwned !== new Set(parsed.data.photos).size) return res.status(400).json({ error: "One or more photos were not uploaded by your account." });
    }
    if (parsed.data.closesAt && new Date(parsed.data.closesAt) <= services.now()) return res.status(400).json({ error: "Closing time must be in the future." });
    const { startingPrice, minimumIncrement, ...editable } = parsed.data;
    Object.assign(listing, editable);
    if (startingPrice !== undefined) listing.startingPricePaise = toPaise(startingPrice);
    if (minimumIncrement !== undefined) listing.minimumIncrementPaise = toPaise(minimumIncrement);
    await listing.save();
    return res.json({ listing: safeListing(listing.toObject() as never) });
  }, services));

  app.post("/api/listings/:id/cancel", requireVerified, asyncRoute(async (req, res) => {
    const id = getRouteId(req);
    if (!Types.ObjectId.isValid(id)) return res.status(404).json({ error: "Auction not found." });
    const now = services.now();
    await closeExpiredAuctions(now, services.emitAuctionUpdate, id);
    const eligible = {
      _id: id,
      sellerId: req.session.userId,
      biddingStatus: { $in: ["Open", "Scheduled"] },
      saleOutcome: "Pending seller decision",
      closesAt: { $gt: now },
      cancelledAt: null
    };
    const existing = await Listing.findOne(eligible);
    if (!existing) return res.status(409).json({ error: "Only your scheduled or open auction can be cancelled." });
    const listing = await Listing.findOneAndUpdate(
      eligible,
      { $set: { biddingStatus: "Cancelled", saleOutcome: "Cancelled", cancelledAt: now, cancellationActorId: req.session.userId, updatedAt: now } },
      { new: true }
    );
    if (!listing) return res.status(409).json({ error: "The auction is no longer eligible for cancellation." });
    const bidderIds = [...new Set(existing.bidHistory.map((bid) => bid.bidderId.toString()))];
    await Promise.all(bidderIds.map((bidderId) => makeNotification(
      new Types.ObjectId(bidderId),
      listing._id,
      "auction_cancelled",
      `${listing.title} was cancelled by the seller.`,
      `cancelled:${listing.id}:${bidderId}`
    )));
    services.emitAuctionUpdate(listing.id);
    return res.json({ listing: safeListing(listing.toObject() as never) });
  }, services));

  app.post("/api/listings/:id/bids", requireVerified, asyncRoute(async (req, res) => {
    const id = getRouteId(req);
    const amountInput = z.object({ amount: z.number().finite().positive().max(1_000_000) }).safeParse(req.body);
    if (!Types.ObjectId.isValid(id)) return res.status(404).json({ error: "Auction not found." });
    if (!amountInput.success) return res.status(400).json({ error: "Enter a valid positive bid amount." });
    const now = services.now();
    const listing = await Listing.findById(id);
    if (!listing) return res.status(404).json({ error: "Auction not found." });
    if (listing.sellerId.toString() === req.session.userId) return res.status(403).json({ error: "You cannot bid on your own listing." });
    if (listing.biddingStatus === "Cancelled") return res.status(409).json({ error: "This auction was cancelled." });
    if (listing.biddingStatus !== "Open" || listing.closesAt <= now) return res.status(409).json({ error: "This auction is closed." });
    const amountPaise = toPaise(amountInput.data.amount);
    if (!Number.isSafeInteger(amountPaise) || amountPaise < 1) return res.status(400).json({ error: "Bid amount is invalid." });
    const minimumPaise = listing.leadingAmountPaise == null ? listing.startingPricePaise : listing.leadingAmountPaise + listing.minimumIncrementPaise;
    if (amountPaise < minimumPaise) {
      return res.status(400).json({
        error: listing.leadingAmountPaise == null ? "Bid is below the starting price." : "Bid is below the required minimum increment.",
        minimumNextBid: toRupees(minimumPaise)
      });
    }
    const user = await User.findById(req.session.userId).select("displayName");
    if (!user) return res.status(401).json({ error: "Your session is no longer valid." });
    const bidId = new Types.ObjectId();
    const bid = {
      bidId,
      bidderId: new Types.ObjectId(req.session.userId),
      bidderAlias: user.displayName,
      amountPaise,
      type: "manual" as const,
      createdAt: now
    };
    const update = await Listing.findOneAndUpdate(
      {
        _id: listing._id,
        biddingStatus: "Open",
        closesAt: { $gt: now },
        leadingBidId: listing.leadingBidId,
        leadingAmountPaise: listing.leadingAmountPaise,
        sellerId: { $ne: req.session.userId }
      },
      {
        $set: {
          leadingBidId: bidId,
          leadingBidderId: req.session.userId,
          leadingAmountPaise: amountPaise,
          updatedAt: now
        },
        $push: { bidHistory: bid }
      },
      { new: true, runValidators: true }
    );
    if (!update) return res.status(409).json({ error: "A bid or auction update happened first. Refresh the auction and try again." });
    if (listing.leadingBidderId) {
      await makeNotification(listing.leadingBidderId, listing._id, "outbid", `You were outbid on ${listing.title}.`, `outbid:${listing._id}:${bidId}`);
    }
    await makeNotification(new Types.ObjectId(req.session.userId), listing._id, "bid_accepted", `Your bid on ${listing.title} was accepted.`, `bid:${listing._id}:${bidId}`);
    services.emitAuctionUpdate(listing.id);
    return res.status(201).json({ bid: { id: bidId.toString(), bidderAlias: user.displayName, amount: toRupees(amountPaise), type: "manual", createdAt: now }, listing: safeListing(update.toObject() as never) });
  }, services));

  app.post("/api/listings/:id/decision", requireVerified, asyncRoute(async (req, res) => {
    const id = getRouteId(req);
    const input = z.object({ decision: z.enum(["approve", "reject"]) }).safeParse(req.body);
    if (!input.success || !Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid seller decision." });
    try {
      const now = services.now();
      await closeExpiredAuctions(now, services.emitAuctionUpdate, id);
      const result = await decideSale(id, new Types.ObjectId(req.session.userId), input.data.decision, now);
      services.emitAuctionUpdate(id);
      return res.json(result);
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : "The seller decision could not be recorded." });
    }
  }, services));

  app.post("/api/listings/:id/handover/confirm", requireVerified, asyncRoute(async (req, res) => {
    const id = getRouteId(req);
    if (!Types.ObjectId.isValid(id)) return res.status(404).json({ error: "Handover not found." });
    try {
      const result = await confirmHandover(id, new Types.ObjectId(req.session.userId), services.now());
      services.emitAuctionUpdate(id);
      return res.json(result);
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : "Confirmation failed." });
    }
  }, services));

  app.post("/api/listings/:id/handover/failed-pickup", requireVerified, asyncRoute(async (req, res) => {
    const id = getRouteId(req);
    if (!Types.ObjectId.isValid(id)) return res.status(404).json({ error: "Handover not found." });
    try {
      await markFailedPickup(id, new Types.ObjectId(req.session.userId), services.now());
      services.emitAuctionUpdate(id);
      return res.status(204).end();
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : "Failed pickup could not be recorded." });
    }
  }, services));

  app.get("/api/notifications", requireAuth, asyncRoute(async (req, res) => {
    const items = await Notification.find({ recipientId: req.session.userId }).sort({ createdAt: -1 }).limit(100).lean();
    return res.json({ items: items.map((item) => ({ id: item._id.toString(), listingId: item.listingId?.toString() ?? null, type: item.type, message: item.message, read: Boolean(item.readAt), createdAt: item.createdAt })) });
  }, services));

  app.post("/api/notifications/:id/read", requireAuth, asyncRoute(async (req, res) => {
    const id = getRouteId(req);
    if (!Types.ObjectId.isValid(id)) return res.status(404).json({ error: "Notification not found." });
    const item = await Notification.findOneAndUpdate(
      { _id: id, recipientId: req.session.userId },
      { $set: { readAt: services.now() } },
      { new: true }
    );
    if (!item) return res.status(404).json({ error: "Notification not found." });
    return res.json({ id: item._id.toString(), read: true });
  }, services));

  app.get("/api/dashboard", requireAuth, asyncRoute(async (req, res) => {
    const [listings, auctionsWithBids, notifications] = await Promise.all([
      Listing.find({ sellerId: req.session.userId }).sort({ createdAt: -1 }).limit(50).lean(),
      Listing.find({ "bidHistory.bidderId": req.session.userId }).select("_id title bidHistory").lean(),
      Notification.countDocuments({ recipientId: req.session.userId, readAt: null })
    ]);
    const ownBids = auctionsWithBids.flatMap((item) => item.bidHistory
      .filter((bid) => bid.bidderId.toString() === req.session.userId)
      .map((bid) => ({ id: bid.bidId.toString(), listingId: item._id.toString(), listingTitle: item.title, amount: toRupees(bid.amountPaise), createdAt: bid.createdAt })))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 50);
    return res.json({
      listings: listings.map((item) => safeListing(item as never)),
      bids: ownBids,
      unreadNotifications: notifications
    });
  }, services));

  app.get("/api/listings/:id/handover", requireAuth, asyncRoute(async (req, res) => {
    const id = getRouteId(req);
    if (!Types.ObjectId.isValid(id)) return res.status(404).json({ error: "Handover not found." });
    const handover = await Handover.findOne({ listingId: id, $or: [{ sellerId: req.session.userId }, { buyerId: req.session.userId }] }).lean();
    if (!handover) return res.status(404).json({ error: "Handover not found." });
    return res.json({
      sellerConfirmedAt: handover.sellerConfirmedAt,
      buyerConfirmedAt: handover.buyerConfirmedAt,
      failedPickupAt: handover.failedPickupAt
    });
  }, services));

  app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found." }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof multer.MulterError) {
      const message = error.code === "LIMIT_FILE_SIZE"
        ? "Images must be 5 MB or smaller."
        : "Image upload failed. Choose one supported image at a time.";
      return res.status(400).json({ error: message });
    }
    if (config.NODE_ENV !== "production") console.error(error);
    return res.status(500).json({ error: "The request could not be completed." });
  });

  return app;
}

function uploadMiddleware() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, _file, callback) => callback(null, true)
  });
}

export { sessionMiddleware };
