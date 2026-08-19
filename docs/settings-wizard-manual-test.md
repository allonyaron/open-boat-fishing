# Settings Wizard — Manual Test Guide

Step-by-step walkthrough to test the operator setup wizard at `/admin/settings`. Follow in order — each section builds on the one before.

---

## Prerequisites

- Dev server running on `http://localhost:3000` (`pnpm dev` from root)
- Admin user seeded (`DATABASE_URL=... pnpm --filter @openboat/db seed:admin`)
- You're logged in at `http://localhost:3000/admin/login` with `admin@example.com` / `changeme`

---

## 1. Find the Settings Entry Point

1. After logging in you land on the **Trips** page.
2. Look at the header nav bar — you should see **Trips · Revenue · Settings**.
3. Click **Settings**.

**Expected:** You land on `/admin/settings` showing five card links:
- Business Info
- Vessels
- Trip Types & Pricing
- Schedules
- Staff

Each card has a short description and a `›` arrow. Nothing should be broken or blank.

---

## 2. Business Info

1. Click **Business Info** (or navigate to `/admin/settings/operator`).

**Expected:** A form pre-filled with the operator's current data — name, emails, phone, dock address, etc.

### Test editing

1. Change the **Phone** field to `(516) 555-0100`.
2. Change the **Cancellation window** to `72`.
3. Click **Save changes**.

**Expected:** The button briefly shows "Saving…" and then the page shows a green **Saved** confirmation below the button. The form fields still show your new values.

4. Navigate away (click **Settings** breadcrumb) then back into **Business Info**.

**Expected:** Your changes persisted — phone shows `(516) 555-0100`, cancel window shows `72`.

### Test validation

1. Clear the **Business name** field and click **Save changes**.

**Expected:** The browser prevents submission (HTML5 `required` validation) — the name field is highlighted.

2. Set **Cancellation window** to a negative number like `-5` and click **Save changes**.

**Expected:** API returns an error message shown in red above the Save button.

---

## 3. Vessels

Navigate to `/admin/settings/vessels` (or Settings › Vessels).

**Expected:** A list of existing boats with their color swatches, capacity, and slug. At the bottom, a dashed **+ Add vessel** button.

### Test adding a vessel

1. Click **+ Add vessel**.

**Expected:** An inline form slides in below the list.

2. Fill in:
   - **Vessel name:** `Test Boat`
   - **Capacity:** `20`
   - Click one of the color preset circles (e.g. the teal one).

3. Click **Add vessel**.

**Expected:** The form disappears and **Test Boat** appears in the list with the color swatch you chose, capacity 20, and an auto-generated slug `test-boat`.

### Test editing a vessel

1. Click **Edit** on any vessel.

**Expected:** An inline edit form appears with the current values pre-filled.

2. Change the **Capacity** to `30`.
3. Click **Save changes**.

**Expected:** The row updates to show capacity 30.

### Test deactivating a vessel

1. Click **Deactivate** on **Test Boat**.

**Expected:** The row immediately shows an **Inactive** badge next to the name.

2. Click **Activate** to restore it.

**Expected:** The Inactive badge disappears.

### Test validation

1. Click **+ Add vessel** and try to submit with no name.

**Expected:** Browser validation catches it before submission.

2. Try adding a vessel with **Capacity** set to `0`.

**Expected:** Browser `min=1` validation prevents submission.

---

## 4. Trip Types & Pricing

Navigate to `/admin/settings/products` (or Settings › Trip Types & Pricing).

**Expected:** Products grouped under their vessel name, each showing the display name, category, and ticket prices. A dashed **+ Add trip type** button at the bottom.

### Test adding a trip type

1. Click **+ Add trip type**.
2. Fill in:
   - **Vessel:** select any active vessel from the dropdown
   - **Category:** `Porgy`
   - **Display name:** `Porgy Fishing Special`
   - **Adult price:** `55.00`
   - **Child price:** `35.00`
   - Leave Senior blank.
3. Click **Add trip type**.

**Expected:** The new trip type appears under the correct vessel group. The prices shown are `Adult: $55.00 · Child: $35.00`. Senior is omitted since you left it blank (no price row created).

### Test editing prices

1. Click **Edit** on your new **Porgy Fishing Special**.
2. Change **Adult price** to `60.00` and add **Senior price** `50.00`.
3. Click **Save changes**.

**Expected:** The row now shows `Adult: $60.00 · Child: $35.00 · Senior: $50.00`.

### Test deactivating a product

1. Click **Deactivate** on the Porgy trip type.

**Expected:** An **Inactive** badge appears on the row.

Note: The trip type won't appear as an option in the Schedules form while inactive. Click **Activate** to restore it.

---

## 5. Schedules

Navigate to `/admin/settings/schedules` (or Settings › Schedules).

**Expected:** A list of existing schedules showing vessel + trip type, date range, days, and times. A dashed **+ Add schedule** button.

> **What schedules do:** When you save a new schedule, it writes individual trip rows to the database for every matching date in the range. These are what appear on the public booking calendar and the admin Trips page.

### Test adding a schedule

1. Click **+ Add schedule**.
2. Fill in:
   - **Trip type:** select **Porgy Fishing Special** (or any active product)
   - **Start date:** today's date
   - **End date:** two weeks from today
   - **Days of week:** click **Sa** and **Su** to select Saturday and Sunday
   - **Departure (UTC):** `12:00` (= 8:00 AM EDT)
   - **Return (UTC):** `17:00` (= 1:00 PM EDT)
   - **Capacity:** `25`
3. Click **Create schedule & generate trips**.

**Expected:**
- The button shows **Creating…** while saving.
- A green success card appears:
  > Schedule created
  > X trips generated on the calendar

  X should be roughly `4–5` (Saturdays + Sundays in the two-week window).

4. Click **Done**.

**Expected:** The new schedule appears in the list.

### Verify trips were created

1. Click **Trips** in the header nav.
2. Look for the next upcoming Saturday or Sunday.

**Expected:** A new trip row appears for the Porgy schedule on the correct dates.

### Observe time zone note

In the schedule form, the small note below the time fields reads:
> Times are stored in UTC. Eastern Time is UTC−5 (winter) / UTC−4 (summer). A 7:00 AM ET departure = 12:00 UTC in winter, 11:00 UTC in summer.

This is the expected behavior — enter times in UTC to match how trip times display throughout the system.

### What happens on duplicate days

Try adding a second schedule for the same product, overlapping the same date range and days. After saving, the success message will show **0 trips generated** (or fewer than expected) — the `ON CONFLICT DO NOTHING` on `(schedule_id, departure_date)` prevents duplicate trip rows.

---

## 6. Staff

Navigate to `/admin/settings/staff` (or Settings › Staff).

**Expected:** A tabbed view with **Admins (N)** and **Mates (N)** tabs. The Admins tab is shown first. Your own account is listed with a **(you)** label.

### Test adding a mate

1. Click **+ Add mate** (make sure the **Mates** tab is active).
2. Fill in:
   - **Role:** Mate (should already be selected)
   - **Name:** `Test Mate`
   - **Email:** `testmate@example.com`
   - **PIN:** `9999`
   - **Assigned vessel:** select any vessel
3. Click **Create account**.

**Expected:** The Mates tab now shows **Test Mate** with the assigned vessel name.

### Verify mate login works

1. Open a **new browser tab** or an **incognito window**.
2. Go to `http://localhost:3000/mate` (the mate check-in app entry point).
3. Log in with `testmate@example.com` and PIN `9999`.

**Expected:** The mate app loads and shows today's manifest (or an empty state if no trips today).

### Test adding an admin

1. Back in the Staff page, click the **Admins** tab.
2. Click **+ Add admin**.
3. Fill in:
   - **Role:** Admin
   - **Name:** `Second Admin`
   - **Email:** `admin2@example.com`
   - **Password:** `password123`
4. Click **Create account**.

**Expected:** Second Admin appears in the Admins list.

5. Open an incognito window, go to `/admin/login`, and log in with `admin2@example.com` / `password123`.

**Expected:** Login succeeds and you land on the Trips page with the name "Second Admin" shown in the top-right.

### Test deactivating a staff member

1. Back in the Staff page, click **Deactivate** next to **Test Mate**.

**Expected:** An **Inactive** badge appears on the row.

2. Try logging in as the mate in an incognito window.

**Expected:** Login fails with an "Account disabled" or similar error.

3. Note: The **Deactivate** button does not appear next to **(you)** — you cannot deactivate your own account.

### Test editing (PIN reset)

1. Click **Edit** on **Test Mate**.
2. Enter a new PIN: `1111`.
3. Click **Save**.

**Expected:** Save succeeds. The old PIN `9999` no longer works; the mate must use `1111`.

---

## 7. End-to-End: New Operator Flow

To experience what it's like to set up a **brand-new operator from scratch**, you can simulate it by using the existing deployment and adding all-new test records:

1. **Settings → Vessels** — Add `My Test Boat` with capacity `15` and any color.
2. **Settings → Trip Types & Pricing** — Add `Bass Fishing` on `My Test Boat`, adult `$75.00`, child `$50.00`.
3. **Settings → Schedules** — Add a schedule for `Bass Fishing`, start/end dates spanning the next month, Fridays + Saturdays, departure `12:00`, return `18:00`, capacity `15`.
4. Click **Create schedule & generate trips**.
5. Go to **Trips** — verify new trips appear for each Friday and Saturday.
6. **Settings → Staff** — Add a mate named `My Mate` with PIN `5678` assigned to `My Test Boat`.

After those five steps, the booking calendar on the public site will show the new trips, the mate can check in at the gangway, and the admin can view the manifest — exactly the same as the existing Captree setup.

---

## Known Limitations (as of this build)

| Gap | Workaround |
|---|---|
| No schedule editing UI — only create | Edit the schedule directly in Drizzle Studio (`pnpm db:studio`) |
| No schedule delete — trips could have bookings | Mark schedule `active = false` in Studio to hide it from future UI |
| Vessel slug is auto-generated from name and cannot be changed in UI | Set it manually at creation time if the auto-slug is wrong |
| Group discount fields (threshold, pct) not exposed in the vessel form | Set via Studio |
| No weekday vs. weekend price split UI (known tech debt) | Create two schedules for the same product with different day sets |
