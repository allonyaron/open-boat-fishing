"use client";

import { useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { Dialog } from "./Dialog";
import { Button, TextButton } from "./Button";
import { Input, Label } from "./Input";

export type FishCount = { species: string; count: number };

export type ReportFormInput = {
  catchSummary: string;
  fishCounts: FishCount[];
  photoUrls: string[];
};

const EMPTY: ReportFormInput = { catchSummary: "", fishCounts: [], photoUrls: [] };

export function ReportDialog({
  open,
  busy,
  tripId,
  tripLabel,
  initial,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  /** Trip to upload photos against — null while nothing is selected yet. */
  tripId: string | null;
  /** e.g. "Half Day Fluke · Miss Montauk — Sat, Sep 26" shown under the title. */
  tripLabel: string;
  /** Pre-fill for "Change it" on a published report; omit for a fresh post. */
  initial?: ReportFormInput;
  onClose: () => void;
  onConfirm: (input: ReportFormInput) => void;
}) {
  const [form, setForm] = useState<ReportFormInput>(initial ?? EMPTY);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setForm(initial ?? EMPTY);
    setUploadError(null);
  }, [open, initial]);

  function addFishCount() {
    setForm((f) => ({ ...f, fishCounts: [...f.fishCounts, { species: "", count: 0 }] }));
  }
  function updateFishCount(i: number, patch: Partial<FishCount>) {
    setForm((f) => ({
      ...f,
      fishCounts: f.fishCounts.map((fc, idx) => (idx === i ? { ...fc, ...patch } : fc)),
    }));
  }
  function removeFishCount(i: number) {
    setForm((f) => ({ ...f, fishCounts: f.fishCounts.filter((_, idx) => idx !== i) }));
  }
  function removePhoto(url: string) {
    setForm((f) => ({ ...f, photoUrls: f.photoUrls.filter((u) => u !== url) }));
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length || !tripId) return;
    setUploading(true);
    setUploadError(null);
    try {
      const uploaded = await Promise.all(
        files.map((file) =>
          upload(`reports/${tripId}/${Date.now()}-${file.name}`, file, {
            access: "public",
            handleUploadUrl: "/api/reports/upload",
          }),
        ),
      );
      setForm((f) => ({ ...f, photoUrls: [...f.photoUrls, ...uploaded.map((u) => u.url)] }));
    } catch {
      setUploadError("Photo upload failed. Try again.");
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const isEdit = !!initial;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Report"
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || uploading} onClick={() => onConfirm(form)}>
            {isEdit ? "Save changes" : "Post it"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="text-13 text-merchant-muted">{tripLabel}</div>

        <div>
          <Label htmlFor="report-summary">Summary</Label>
          <textarea
            id="report-summary"
            value={form.catchSummary}
            maxLength={2000}
            onChange={(e) => setForm((f) => ({ ...f, catchSummary: e.target.value }))}
            rows={4}
            className="w-full rounded-lg border border-merchant-input px-2.5 py-2.5 text-14 text-merchant-ink focus:outline-none focus:ring-2 focus:ring-merchant-blue-tint focus:border-merchant-blue"
            placeholder="How the day went, conditions, where they were biting…"
          />
        </div>

        <div>
          <div className="text-13 text-merchant-ink mb-1.5">Fish counts</div>
          <div className="flex flex-col gap-2">
            {form.fishCounts.map((fc, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  aria-label="Species"
                  value={fc.species}
                  placeholder="Species"
                  onChange={(e) => updateFishCount(i, { species: e.target.value })}
                  className="flex-1"
                />
                <Input
                  aria-label="Count"
                  type="number"
                  min={0}
                  value={fc.count}
                  onChange={(e) => updateFishCount(i, { count: Number(e.target.value) })}
                  className="w-24"
                />
                <TextButton onClick={() => removeFishCount(i)} className="text-merchant-red flex-shrink-0">
                  Remove
                </TextButton>
              </div>
            ))}
          </div>
          <TextButton onClick={addFishCount} className="mt-2">
            + Add a species
          </TextButton>
        </div>

        <div>
          <div className="text-13 text-merchant-ink mb-1.5">Photos</div>
          {form.photoUrls.length > 0 && (
            <div className="grid grid-cols-4 gap-2 mb-2">
              {form.photoUrls.map((url) => (
                // eslint-disable-next-line @next/next/no-img-element
                <div key={url} className="relative aspect-square rounded-lg overflow-hidden bg-merchant-fill-3">
                  <img src={url} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => removePhoto(url)}
                    aria-label="Remove photo"
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-12 leading-none flex items-center justify-center"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handlePhotoUpload}
            disabled={!tripId}
          />
          <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading || !tripId}>
            {uploading ? "Uploading…" : "Add photos"}
          </Button>
          {uploadError && <p className="mt-1.5 text-13 text-merchant-red">{uploadError}</p>}
        </div>

        <p className="text-12 text-merchant-faint">This goes up on your Fishing Reports page as soon as you post it.</p>
      </div>
    </Dialog>
  );
}
