import mongoose, { Schema, Types } from "mongoose";

export type BiddingStatus = "Scheduled" | "Open" | "Closed" | "Cancelled";
export type SaleOutcome = "Pending seller decision" | "Reserved" | "Awaiting handover" | "Completed" | "Rejected" | "Failed pickup" | "Unsold" | "Cancelled";
export interface UserRecord {
  _id?: Types.ObjectId;
  email: string;
  passwordHash: string;
  displayName: string;
  verifiedAt: Date | null;
  verificationTokenHash?: string;
  accountStatus: "active" | "disabled";
  createdAt?: Date;
  updatedAt?: Date;
}
export interface BidRecord {
  listingId: Types.ObjectId;
  bidId: Types.ObjectId;
  bidderId: Types.ObjectId;
  bidderAlias: string;
  amountPaise: number;
  type: "manual" | "automatic";
  createdAt: Date;
}
export interface ListingRecord {
  sellerId: Types.ObjectId;
  title: string;
  category: "Cycles" | "Calculators" | "Books" | "Electronics" | "Other";
  description: string;
  condition: "New" | "Like New" | "Good" | "Fair" | "Poor";
  photos: string[];
  startingPricePaise: number;
  minimumIncrementPaise: number;
  closesAt: Date;
  biddingStatus: BiddingStatus;
  saleOutcome: SaleOutcome;
  leadingBidId: Types.ObjectId | null;
  leadingBidderId: Types.ObjectId | null;
  leadingAmountPaise: number | null;
  bidHistory: BidRecord[];
  provisionalWinnerId: Types.ObjectId | null;
  cancelledAt: Date | null;
  cancellationActorId: Types.ObjectId | null;
  sellerDecisionAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface NotificationRecord {
  _id?: Types.ObjectId;
  recipientId: Types.ObjectId;
  listingId?: Types.ObjectId;
  type: string;
  message: string;
  idempotencyKey: string;
  readAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}
export interface HandoverRecord {
  listingId: Types.ObjectId;
  sellerId: Types.ObjectId;
  buyerId: Types.ObjectId;
  sellerConfirmedAt: Date | null;
  buyerConfirmedAt: Date | null;
  failedPickupAt: Date | null;
  failedPickupActorId: Types.ObjectId | null;
}
export interface PhotoAssetRecord {
  ownerId: Types.ObjectId;
  url: string;
  mimeType: string;
}

const userSchema = new Schema<UserRecord>({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  displayName: { type: String, required: true, trim: true, maxlength: 60 },
  verifiedAt: { type: Date, default: null },
  verificationTokenHash: { type: String, select: false },
  accountStatus: { type: String, enum: ["active", "disabled"], default: "active" }
}, { timestamps: true });

const bidSchema = new Schema<BidRecord>({
  listingId: { type: Schema.Types.ObjectId, ref: "Listing", required: true, index: true },
  bidderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  amountPaise: { type: Number, required: true, min: 1 },
  type: { type: String, enum: ["manual", "automatic"], default: "manual" },
  createdAt: { type: Date, required: true },
  bidderAlias: { type: String, required: true }
});
bidSchema.index({ listingId: 1, amountPaise: -1, createdAt: 1 });

const listingSchema = new Schema<ListingRecord>({
  sellerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  title: { type: String, required: true, trim: true, minlength: 3, maxlength: 100 },
  category: { type: String, enum: ["Cycles", "Calculators", "Books", "Electronics", "Other"], required: true },
  description: { type: String, required: true, trim: true, minlength: 10, maxlength: 4000 },
  condition: { type: String, enum: ["New", "Like New", "Good", "Fair", "Poor"], required: true },
  photos: { type: [String], default: [], validate: (photos: string[]) => photos.length <= 5 },
  startingPricePaise: { type: Number, required: true, min: 1 },
  minimumIncrementPaise: { type: Number, required: true, min: 1 },
  closesAt: { type: Date, required: true, index: true },
  biddingStatus: { type: String, enum: ["Scheduled", "Open", "Closed", "Cancelled"], default: "Scheduled", index: true },
  saleOutcome: { type: String, enum: ["Pending seller decision", "Reserved", "Awaiting handover", "Completed", "Rejected", "Failed pickup", "Unsold", "Cancelled"], default: "Pending seller decision" },
  leadingBidId: { type: Schema.Types.ObjectId, ref: "Bid", default: null },
  leadingBidderId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  leadingAmountPaise: { type: Number, default: null },
  bidHistory: {
    type: [{
      bidId: { type: Schema.Types.ObjectId, required: true },
      bidderId: { type: Schema.Types.ObjectId, required: true },
      bidderAlias: { type: String, required: true },
      amountPaise: { type: Number, required: true },
      type: { type: String, enum: ["manual", "automatic"], required: true },
      createdAt: { type: Date, required: true }
    }],
    default: []
  },
  provisionalWinnerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  cancelledAt: { type: Date, default: null },
  cancellationActorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  sellerDecisionAt: { type: Date, default: null },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });
listingSchema.index({ title: "text", description: "text", category: "text" });
listingSchema.index({ biddingStatus: 1, closesAt: 1 });

const notificationSchema = new Schema<NotificationRecord>({
  recipientId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  listingId: { type: Schema.Types.ObjectId, ref: "Listing" },
  type: { type: String, required: true },
  message: { type: String, required: true, maxlength: 240 },
  idempotencyKey: { type: String, required: true, unique: true },
  readAt: { type: Date, default: null }
}, { timestamps: true });

const handoverSchema = new Schema<HandoverRecord>({
  listingId: { type: Schema.Types.ObjectId, ref: "Listing", required: true, unique: true },
  sellerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  buyerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  sellerConfirmedAt: { type: Date, default: null },
  buyerConfirmedAt: { type: Date, default: null },
  failedPickupAt: { type: Date, default: null },
  failedPickupActorId: { type: Schema.Types.ObjectId, ref: "User", default: null }
}, { timestamps: true });

const photoAssetSchema = new Schema<PhotoAssetRecord>({
  ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  url: { type: String, required: true, unique: true },
  mimeType: { type: String, enum: ["image/jpeg", "image/png", "image/webp"], required: true }
}, { timestamps: true });

export const User = (mongoose.models.User as mongoose.Model<UserRecord> | undefined) ?? mongoose.model<UserRecord>("User", userSchema);
export const Bid = (mongoose.models.Bid as mongoose.Model<BidRecord> | undefined) ?? mongoose.model<BidRecord>("Bid", bidSchema);
export const Listing = (mongoose.models.Listing as mongoose.Model<ListingRecord> | undefined) ?? mongoose.model<ListingRecord>("Listing", listingSchema);
export const Notification = (mongoose.models.Notification as mongoose.Model<NotificationRecord> | undefined) ?? mongoose.model<NotificationRecord>("Notification", notificationSchema);
export const Handover = (mongoose.models.Handover as mongoose.Model<HandoverRecord> | undefined) ?? mongoose.model<HandoverRecord>("Handover", handoverSchema);
export const PhotoAsset = (mongoose.models.PhotoAsset as mongoose.Model<PhotoAssetRecord> | undefined) ?? mongoose.model<PhotoAssetRecord>("PhotoAsset", photoAssetSchema);

export interface AuthenticatedRequest extends Express.Request {
  userId?: Types.ObjectId;
}

export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function toRupees(paise: number | null | undefined): number | null {
  return paise == null ? null : paise / 100;
}
