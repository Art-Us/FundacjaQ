import { getAllocationStatusInfo } from '@/lib/resourceLabels';

interface AllocationStatusBadgeProps {
  status: string;
  className?: string;
}

// Shared visual for a ResourceAllocation's status (Крок 45) — extracted so
// AllocationContributorsList (Крок 44), AllocationInboxPanel (Крок 36) and any
// later allocation-detail view render the exact same badge instead of each
// duplicating getAllocationStatusInfo's markup.
export default function AllocationStatusBadge({ status, className = '' }: AllocationStatusBadgeProps) {
  const info = getAllocationStatusInfo(status);
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${info.badgeClass} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${info.dotClass}`} />
      {info.label}
    </span>
  );
}
