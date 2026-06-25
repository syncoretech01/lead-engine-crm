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
            "List-Unsubscribe": "<https://app.syncore.test/api/unsubscribe?t=abc>",
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
    expect(message).toContain("List-Unsubscribe: <https://app.syncore.test/api/unsubscribe?t=abc>\r\n");
    expect(message).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n");
    expect(message).toContain("Content-Type: multipart/alternative;");
    expect(message).toContain(Buffer.from("Plain hello", "utf8").toString("base64"));
    expect(message).toContain(Buffer.from("<p>Plain hello</p>", "utf8").toString("base64"));
    expect(message).not.toMatch(/[^\r]\n/);
  });
});
