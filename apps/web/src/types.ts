export type User = {
  id: string;
  email: string;
  displayName: string;
  verified: boolean;
};

export type Bid = {
  id: string;
  bidderAlias: string;
  amount: number;
  type: "manual" | "automatic";
  createdAt: string;
};

export type Listing = {
  _id: string;
  sellerDisplayName?: string;
  isSeller?: boolean;
  isProvisionalWinner?: boolean;
  title: string;
  category: "Cycles" | "Calculators" | "Books" | "Electronics" | "Other";
  description: string;
  condition: "New" | "Like New" | "Good" | "Fair" | "Poor";
  photos: string[];
  startingPrice: number;
  minimumIncrement: number;
  leadingAmount: number | null;
  minimumNextBid: number;
  closesAt: string;
  biddingStatus: "Scheduled" | "Open" | "Closed" | "Cancelled";
  saleOutcome: string;
  bidHistory: Bid[];
};
