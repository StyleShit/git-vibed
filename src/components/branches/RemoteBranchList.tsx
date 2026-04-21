import { forwardRef } from "react";
import { BranchList, type BranchListHandle } from "./BranchList";

// Thin wrapper so the Sidebar accordion has a single-purpose component per
// section. Remote branches reuse the same tree rendering as local, just
// filtered down. Forwards the imperative handle for collapse/expand all.
export const RemoteBranchList = forwardRef<BranchListHandle, { filter: string }>(
  function RemoteBranchList({ filter }, ref) {
    return <BranchList ref={ref} filter={filter} kind="remote" />;
  },
);
