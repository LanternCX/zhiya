import { Download } from "lucide-react";
import { ActionLink } from "../ui/Action";

export function ProductLink({ compact = false }: { compact?: boolean }) {
  const size = compact ? "compact" : "default";
  return <ActionLink href="#download" size={size}>下载知芽<Download aria-hidden="true" /></ActionLink>;
}
