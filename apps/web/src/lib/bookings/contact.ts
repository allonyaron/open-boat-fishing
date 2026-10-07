import { z } from "zod";

/** Who the booking is for. Set on create, and editable while the booking is pending. */
export const customerContactSchema = z.object({
  customerEmail: z.string().email().max(254).transform((s) => s.toLowerCase().trim()),
  customerName: z.string().max(100).nullish(),
  customerPhone: z.string().max(20).nullish(),
});
