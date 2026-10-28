import { Types } from "mongoose";
import { Handover, Listing, Notification, User } from "./models.js";
import type { BiddingStatus, SaleOutcome } from "./models.js";

export type Clock = () => Date;

export async function makeNotification(
  recipientId: Types.ObjectId,
  listingId: Types.ObjectId | undefined,
  type: string,
  message: string,
  idempotencyKey: string
) {
  return Notification.updateOne(
    { idempotencyKey },
    { $setOnInsert: { recipientId, listingId, type, message } },
    { upsert: true }
  );
}

export async function closeExpiredAuctions(now: Date, emit?: (listingId: string) => void): Promise<number> {
  const expired = await Listing.find({ biddingStatus: "Open", closesAt: { $lte: now } }).select("_id sellerId title bidHistory");
  let closed = 0;
  for (const candidate of expired) {
    const leadingBid = [...candidate.bidHistory].sort((a, b) => b.amountPaise - a.amountPaise || a.createdAt.getTime() - b.createdAt.getTime())[0];
    const listing = await Listing.findOneAndUpdate(
      { _id: candidate._id, biddingStatus: "Open", closesAt: { $lte: now } },
      {
        $set: {
          biddingStatus: "Closed",
          saleOutcome: leadingBid ? "Pending seller decision" : "Unsold",
          provisionalWinnerId: leadingBid?.bidderId ?? null,
          updatedAt: now
        }
      },
      { new: true }
    );
    if (!listing) continue;

    if (!leadingBid) {
      await makeNotification(listing.sellerId, listing._id, "auction_unsold", `${listing.title} closed without bids.`, `closed:${listing.id}:unsold`);
    } else {
      await makeNotification(listing.sellerId, listing._id, "auction_closed", `${listing.title} closed. Review the provisional winning bid.`, `closed:${listing.id}:seller`);
      await makeNotification(leadingBid.bidderId, listing._id, "provisional_win", `You are the provisional winner for ${listing.title}.`, `closed:${listing.id}:winner`);
    }
    emit?.(listing.id);
    closed += 1;
  }
  return closed;
}

export async function decideSale(
  listingId: string,
  sellerId: Types.ObjectId,
  decision: "approve" | "reject",
  now: Date
): Promise<{ biddingStatus: BiddingStatus; saleOutcome: SaleOutcome; winnerId: Types.ObjectId }> {
  const listing = await Listing.findOne({
    _id: listingId,
    sellerId,
    biddingStatus: "Closed",
    saleOutcome: "Pending seller decision",
    provisionalWinnerId: { $ne: null }
  });
  if (!listing || !listing.provisionalWinnerId) throw new Error("This auction is not awaiting your decision.");

  const outcome = decision === "approve" ? "Awaiting handover" : "Rejected";
  const updated = await Listing.findOneAndUpdate(
    { _id: listingId, sellerId, biddingStatus: "Closed", saleOutcome: "Pending seller decision" },
    { $set: { saleOutcome: outcome, sellerDecisionAt: now, updatedAt: now } },
    { new: true }
  );
  if (!updated || !updated.provisionalWinnerId) throw new Error("This auction decision was already recorded.");

  await makeNotification(
    updated.provisionalWinnerId,
    updated._id,
    decision === "approve" ? "seller_approved" : "seller_rejected",
    decision === "approve" ? `${updated.title} is reserved for you. Coordinate the campus handover.` : `The seller declined the winning bid for ${updated.title}.`,
    `seller-decision:${updated.id}:${decision}`
  );

  if (decision === "approve") {
    await Handover.updateOne(
      { listingId: updated._id },
      { $setOnInsert: { sellerId, buyerId: updated.provisionalWinnerId } },
      { upsert: true }
    );
  }
  return { biddingStatus: updated.biddingStatus as BiddingStatus, saleOutcome: updated.saleOutcome as SaleOutcome, winnerId: updated.provisionalWinnerId };
}

export async function confirmHandover(
  listingId: string,
  actorId: Types.ObjectId,
  now: Date
): Promise<{ sellerConfirmedAt: Date | null; buyerConfirmedAt: Date | null; complete: boolean }> {
  const handover = await Handover.findOne({ listingId, $or: [{ sellerId: actorId }, { buyerId: actorId }] });
  if (!handover) throw new Error("You are not a participant in this handover.");
  if (handover.failedPickupAt) throw new Error("This handover was already marked as a failed pickup.");

  const field = handover.sellerId.equals(actorId) ? "sellerConfirmedAt" : "buyerConfirmedAt";
  if (field === "sellerConfirmedAt" ? handover.sellerConfirmedAt : handover.buyerConfirmedAt) {
    throw new Error("Your handover confirmation was already recorded.");
  }
  const updated = await Handover.findOneAndUpdate(
    { _id: handover._id, [field]: null, failedPickupAt: null },
    { $set: { [field]: now } },
    { new: true }
  );
  if (!updated && (field === "sellerConfirmedAt" ? !handover.sellerConfirmedAt : !handover.buyerConfirmedAt)) {
    throw new Error("Handover confirmation could not be recorded.");
  }
  const record = updated ?? handover;
  const complete = Boolean(record.sellerConfirmedAt && record.buyerConfirmedAt);
  if (complete) {
    const listing = await Listing.findOneAndUpdate(
      { _id: listingId, saleOutcome: "Awaiting handover" },
      { $set: { saleOutcome: "Completed", updatedAt: now } },
      { new: true }
    );
    if (listing) {
      await makeNotification(listing.sellerId, listing._id, "sale_completed", `${listing.title} handover is complete.`, `completed:${listing.id}:seller`);
      await makeNotification(record.buyerId, listing._id, "sale_completed", `${listing.title} handover is complete.`, `completed:${listing.id}:buyer`);
    }
  }
  return { sellerConfirmedAt: record.sellerConfirmedAt, buyerConfirmedAt: record.buyerConfirmedAt, complete };
}

export async function markFailedPickup(listingId: string, actorId: Types.ObjectId, now: Date): Promise<void> {
  const handover = await Handover.findOneAndUpdate(
    { listingId, $or: [{ sellerId: actorId }, { buyerId: actorId }], failedPickupAt: null },
    { $set: { failedPickupAt: now, failedPickupActorId: actorId } },
    { new: true }
  );
  if (!handover) throw new Error("You cannot update this handover, or it is already resolved.");
  await Listing.findOneAndUpdate(
    { _id: listingId, saleOutcome: "Awaiting handover" },
    { $set: { saleOutcome: "Failed pickup", updatedAt: now } }
  );
  const listing = await Listing.findById(listingId);
  if (listing) {
    await makeNotification(listing.sellerId, listing._id, "failed_pickup", `${listing.title} handover was marked as a failed pickup.`, `failed-pickup:${listing.id}:seller`);
    await makeNotification(handover.buyerId, listing._id, "failed_pickup", `${listing.title} handover was marked as a failed pickup.`, `failed-pickup:${listing.id}:buyer`);
  }
}

export async function getDisplayNames(ids: Types.ObjectId[]) {
  return User.find({ _id: { $in: ids } }).select("displayName").lean();
}
