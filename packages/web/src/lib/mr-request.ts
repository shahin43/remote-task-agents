import type { MrRequestView } from "../api/types";

export function mrNeedsApproval(mr: MrRequestView | null | undefined): boolean {
  return mr?.status === "pending_approval";
}

export function mrNeedsAttention(mr: MrRequestView | null | undefined): boolean {
  return mr?.status === "pending_approval" || mr?.status === "failed" || mr?.status === "blocked";
}

export function mrStatusLabel(status: MrRequestView["status"]): string {
  switch (status) {
    case "pending_approval":
      return "Awaiting approval";
    case "opened":
      return "Git artifacts produced";
    case "failed":
      return "Promotion failed";
    case "blocked":
      return "Blocked";
    case "rejected":
      return "Rejected";
    default:
      return status;
  }
}

export function mrCardBadgeText(mr: MrRequestView): string {
  switch (mr.status) {
    case "pending_approval":
      return "MR approval pending";
    case "failed":
      return "MR promotion failed";
    case "blocked":
      return "MR blocked";
    case "opened":
      return "Artifacts ready";
    default:
      return "";
  }
}
