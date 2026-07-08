import { describe, expect, it } from "vitest";
import { buildMimeMessage } from "@/lib/providers/adapters/amazon-ses";

describe("Amazon SES raw MIME builder", () => {
  it("includes unsubscribe headers and multipart text/html bodies without touching the network", () => {
    const message = Buffer.from(
      buildMimeMessage(
        {
          to: "lead@example.com",
          from: "Bobby Jones <bobby@syncoretech.com>",
          subject: "Hello from Syncore",
          replyTo: "replies@syncoretech.com",
          text: "Plain hello",
          html: "<p>Plain hello</p>",
          headers: {
            "List-Unsubscribe": "<https://app.syncore.test/api/unsubscribe?c=contact-a&s=abc>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
          }
        },
        "Bobby Jones <bobby@syncoretech.com>"
      )
    ).toString("utf8");

    expect(message).toContain("From: Bobby Jones <bobby@syncoretech.com>\r\n");
    expect(message).toContain("To: lead@example.com\r\n");
    expect(message).toContain("Subject: Hello from Syncore\r\n");
    expect(message).toContain("Reply-To: replies@syncoretech.com\r\n");
    expect(message).toContain("MIME-Version: 1.0\r\n");
    expect(message).toContain("List-Unsubscribe: <https://app.syncore.test/api/unsubscribe?c=contact-a&s=abc>\r\n");
    expect(message).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n");
    expect(message).toContain("Content-Type: multipart/alternative;");
    expect(message).toContain(Buffer.from("Plain hello", "utf8").toString("base64"));
    expect(message).toContain(Buffer.from("<p>Plain hello</p>", "utf8").toString("base64"));
    expect(message).not.toMatch(/[^\r]\n/);
  });

  it("wraps the body and attachments in multipart/mixed with attachment parts", () => {
    const pdfBase64 = Buffer.from("%PDF-1.4 fake report bytes", "utf8").toString("base64");
    const message = Buffer.from(
      buildMimeMessage(
        {
          to: "lead@example.com",
          from: "Sam Carter <sam@syncoretech.com>",
          subject: "Deck attached",
          text: "See attached.",
          html: "<p>See attached.</p>",
          headers: { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
          attachments: [{ filename: "Q3 report.pdf", contentType: "application/pdf", content: pdfBase64 }]
        },
        "Sam Carter <sam@syncoretech.com>"
      )
    ).toString("utf8");

    // Top-level is multipart/mixed; the text/html body is nested inside as a part.
    expect(message).toContain("Content-Type: multipart/mixed;");
    expect(message).toContain("Content-Type: multipart/alternative;");
    // Attachment part headers + payload.
    expect(message).toContain('Content-Type: application/pdf; name="Q3 report.pdf"');
    expect(message).toContain('Content-Disposition: attachment; filename="Q3 report.pdf"');
    expect(message).toContain("Content-Transfer-Encoding: base64");
    expect(message).toContain(pdfBase64);
    // Still CRLF-only line endings.
    expect(message).not.toMatch(/[^\r]\n/);
  });
});
