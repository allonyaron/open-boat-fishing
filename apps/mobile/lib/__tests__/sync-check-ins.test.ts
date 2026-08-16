import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncCheckIns, type CheckInQueueEntry } from "../mate-store";

// mate-store imports expo-sqlite; mock it so the module loads in Node
vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: vi.fn(),
}));

const API_URL = "http://localhost:3000";
const TOKEN = "test-token";

function makeEntry(localId: string): CheckInQueueEntry {
  return {
    localId,
    ticketId: `ticket-${localId}`,
    tripId: "trip-1",
    method: "qr",
    note: null,
    checkedInAt: new Date().toISOString(),
    synced: false,
    syncError: null,
  };
}

describe("syncCheckIns", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("does nothing when queue is empty", async () => {
    const getUnsynced = vi.fn().mockResolvedValue([]);
    const markSynced = vi.fn();
    const markError = vi.fn();

    await syncCheckIns(TOKEN, API_URL, { getUnsynced, markSynced, markError });

    expect(fetch).not.toHaveBeenCalled();
    expect(markSynced).not.toHaveBeenCalled();
  });

  it("posts unsynced entries to the API", async () => {
    const entries = [makeEntry("a"), makeEntry("b")];
    const getUnsynced = vi.fn().mockResolvedValue(entries);
    const markSynced = vi.fn().mockResolvedValue(undefined);
    const markError = vi.fn();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ localId: "a", ok: true }, { localId: "b", ok: true }] }),
    } as Response);

    await syncCheckIns(TOKEN, API_URL, { getUnsynced, markSynced, markError });

    expect(fetch).toHaveBeenCalledWith(`${API_URL}/api/mate/checkins`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ events: entries }),
    });
    expect(markSynced).toHaveBeenCalledWith("a");
    expect(markSynced).toHaveBeenCalledWith("b");
  });

  it("marks entries with known errors using markError", async () => {
    const entries = [makeEntry("x")];
    const getUnsynced = vi.fn().mockResolvedValue(entries);
    const markSynced = vi.fn();
    const markError = vi.fn().mockResolvedValue(undefined);

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ localId: "x", ok: false, error: "ticket_not_found" }],
      }),
    } as Response);

    await syncCheckIns(TOKEN, API_URL, { getUnsynced, markSynced, markError });

    expect(markError).toHaveBeenCalledWith("x", "ticket_not_found");
    expect(markSynced).not.toHaveBeenCalled();
  });

  it("does not mark entries for unknown errors", async () => {
    const entries = [makeEntry("y")];
    const getUnsynced = vi.fn().mockResolvedValue(entries);
    const markSynced = vi.fn();
    const markError = vi.fn();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ localId: "y", ok: false, error: "some_other_error" }],
      }),
    } as Response);

    await syncCheckIns(TOKEN, API_URL, { getUnsynced, markSynced, markError });

    expect(markSynced).not.toHaveBeenCalled();
    expect(markError).not.toHaveBeenCalled();
  });

  it("swallows network errors (offline — leave in queue)", async () => {
    const entries = [makeEntry("z")];
    const getUnsynced = vi.fn().mockResolvedValue(entries);
    const markSynced = vi.fn();
    const markError = vi.fn();

    vi.mocked(fetch).mockRejectedValue(new Error("Network request failed"));

    await expect(
      syncCheckIns(TOKEN, API_URL, { getUnsynced, markSynced, markError }),
    ).resolves.toBeUndefined();

    expect(markSynced).not.toHaveBeenCalled();
  });
});
