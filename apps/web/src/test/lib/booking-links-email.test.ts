import { describe, it, expect } from "vitest";
import { bookingLinksEmailHtml } from "@/lib/email";

describe("bookingLinksEmailHtml", () => {
  const base = { to: "a@b.com", fromAddress: "x@y.com" };

  it("links each booking and escapes what it prints", () => {
    const html = bookingLinksEmailHtml({
      ...base,
      operatorName: "Bob's <Boats>",
      links: [{ confirmationCode: "AB12CD", tripLabel: 'Fluke "Half" & <Day>', url: "https://x.test/boarding/1?k=a&b" }],
    });
    expect(html).toContain("Bob's &lt;Boats&gt;");
    expect(html).toContain("Fluke &quot;Half&quot; &amp; &lt;Day&gt;");
    expect(html).toContain('href="https://x.test/boarding/1?k=a&amp;b"');
    expect(html).toContain("Confirmation #AB12CD");
    expect(html).toContain("is the link");
  });

  it("says links when there are several", () => {
    const link = { confirmationCode: "A", tripLabel: "T", url: "u" };
    expect(bookingLinksEmailHtml({ ...base, operatorName: "O", links: [link, link] })).toContain("are the links");
  });
});
