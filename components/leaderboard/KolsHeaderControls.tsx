"use client";

import { CalendarDays, ArrowUpDown } from "lucide-react";
import { Dropdown, MenuItem } from "./primitives";

type SortKey =
  | "views"
  | "engs"
  | "tweets"
  | "totalER"
  | "shills"
  | "shillViews"
  | "shillEngs"
  | "shillsER";

export function KolsHeaderControls({
  days,
  sortKey,
  onSetDays,
  onSetSortKey,
}: {
  days: 7 | 30;
  sortKey: SortKey;
  onSetDays: (d: 7 | 30) => void;
  onSetSortKey: (k: SortKey) => void;
}) {

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Dropdown
        label={`${days === 7 ? "7d" : "30d"} Period`}
        icon={<CalendarDays size={16} className="text-gray-300" />}
      >
        <MenuItem active={days === 7} onClick={() => onSetDays(7)}>7 days</MenuItem>
        <MenuItem active={days === 30} onClick={() => onSetDays(30)}>30 days</MenuItem>
      </Dropdown>

      <Dropdown
        label="Sort"
        icon={<ArrowUpDown size={16} className="text-gray-300" />}
      >
        <MenuItem active={sortKey === "views"} onClick={() => onSetSortKey("views")}>Total Views</MenuItem>
        <MenuItem active={sortKey === "engs"} onClick={() => onSetSortKey("engs")}>Total Engagements</MenuItem>
        <MenuItem active={sortKey === "tweets"} onClick={() => onSetSortKey("tweets")}>Total Tweets</MenuItem>
        <MenuItem active={sortKey === "totalER"} onClick={() => onSetSortKey("totalER")}>Total ER</MenuItem>
        <div className="my-1 h-px bg-white/10" />
        <MenuItem active={sortKey === "shills"} onClick={() => onSetSortKey("shills")}>Shill Tweets</MenuItem>
        <MenuItem active={sortKey === "shillViews"} onClick={() => onSetSortKey("shillViews")}>Shill Views</MenuItem>
        <MenuItem active={sortKey === "shillEngs"} onClick={() => onSetSortKey("shillEngs")}>Shill Engagements</MenuItem>
        <MenuItem active={sortKey === "shillsER"} onClick={() => onSetSortKey("shillsER")}>Shill ER</MenuItem>
      </Dropdown>
    </div>
  );
}
