import type { DashboardSnapshotState } from "@/lib/dashboard/domain";

const snapshotState: DashboardSnapshotState = {
  lastSnapshot: null,
  history: [],
};

export function loadSnapshotState(): DashboardSnapshotState {
  return {
    lastSnapshot: snapshotState.lastSnapshot,
    history: [...snapshotState.history],
  };
}

export function persistSnapshotState(nextState: DashboardSnapshotState) {
  snapshotState.lastSnapshot = nextState.lastSnapshot;
  snapshotState.history = [...nextState.history];
}
