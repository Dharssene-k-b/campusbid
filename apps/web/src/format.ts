export function formatRupees(amount: number | null | undefined): string {
  if (amount == null) return "No bids yet";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(amount);
}

export function formatTime(value: string | Date): string {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function countdown(value: string, now: number): string {
  const difference = new Date(value).getTime() - now;
  if (!Number.isFinite(difference) || difference <= 0) return "Auction ended";
  const totalSeconds = Math.floor(difference / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const clock = `${hours.toString().padStart(2, "0")}h ${minutes.toString().padStart(2, "0")}m ${seconds.toString().padStart(2, "0")}s`;
  return days > 0 ? `${days.toString().padStart(2, "0")}d ${clock}` : clock;
}
