"use client";

import { useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { FieldError, Input, Label, Textarea } from "./Input";
import { CameraIcon, CloseIcon, PlusIcon } from "./icons";

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
      title={isEdit ? "Change the report" : "Post the report"}
      subtitle={tripLabel}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="key" className="px-6" disabled={busy || uploading} onClick={() => onConfirm(form)}>
            {isEdit ? "Save changes" : "Post it"}
          </Button>
        </>
      }
    >
      <div>
        <Label htmlFor="report-summary">Summary</Label>
        <Textarea
          id="report-summary"
          value={form.catchSummary}
          maxLength={2000}
          rows={4}
          onChange={(e) => setForm((f) => ({ ...f, catchSummary: e.target.value }))}
          placeholder="How the day went, conditions, where they were biting…"
        />
      </div>

      <fieldset className="flex flex-col gap-2 border-0 m-0 p-0">
        <legend className="text-body-sm font-bold mb-1.5 p-0">Fish counts</legend>
        {form.fishCounts.map((fc, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_96px_auto] gap-2 items-center">
            <Input
              aria-label="Species"
              value={fc.species}
              placeholder="Species"
              onChange={(e) => updateFishCount(i, { species: e.target.value })}
            />
            <Input
              aria-label="Count"
              type="number"
              inputMode="numeric"
              min={0}
              value={fc.count}
              className="text-right"
              onChange={(e) => updateFishCount(i, { count: Number(e.target.value) })}
            />
            <button
              type="button"
              aria-label={`Remove ${fc.species || "this species"}`}
              onClick={() => removeFishCount(i)}
              className="min-h-field px-3 bg-transparent text-ob-ink-2 border-2 border-ob-hair rounded-ob text-body-sm font-bold hover:bg-ob-panel-2"
            >
              Remove
            </button>
          </div>
        ))}
        <Button variant="secondary" size="dock" icon={<PlusIcon size={16} />} className="self-start" onClick={addFishCount}>
          Add a species
        </Button>
      </fieldset>

      <div>
        <div className="text-body-sm font-bold mb-2">Photos</div>
        {form.photoUrls.length > 0 && (
          <div className="grid grid-cols-4 gap-2 mb-2.5">
            {form.photoUrls.map((url) => (
              <div key={url} className="relative aspect-square overflow-hidden bg-ob-panel-2 border border-ob-hair">
                <img src={url} alt="" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(url)}
                  aria-label="Remove photo"
                  className="absolute top-1 right-1 w-9 h-9 flex items-center justify-center bg-ob-scrim text-white rounded-ob"
                >
                  <CloseIcon size={18} />
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
        <Button
          variant="secondary"
          size="dock"
          icon={<CameraIcon />}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || !tripId}
        >
          {uploading ? "Uploading…" : "Add photos"}
        </Button>
        {uploadError && <FieldError>{uploadError}</FieldError>}
      </div>

      <p className="m-0 text-body-sm text-ob-ink-2">This goes up on your Fishing Reports page as soon as you post it.</p>
    </Dialog>
  );
}
