import { describe, expect, it } from "vitest";
import { parsePath } from "../scripts/media-import";
import { PHOTO_REQUEST } from "@/lib/ai/orchestrator";

const root = "/media-library";

describe("media import filename parsing", () => {
  it("parses subject/day/tags from the path convention", () => {
    const p = parsePath(root, `${root}/odin/d3-socks.jpg`);
    expect(p).toMatchObject({
      subject: "odin",
      unlockDay: 3,
      tags: ["socks"],
      intimacyTier: 1,
      storagePath: "odin/d3-socks.jpg",
    });
  });

  it("self defaults to tier 2; close subfolder is tier 3", () => {
    const self = parsePath(root, `${root}/self/d10-outfit.jpg`);
    const close = parsePath(root, `${root}/self/close/d21-morning.jpg`);
    expect(self).toMatchObject({ intimacyTier: 2 });
    expect(close).toMatchObject({ intimacyTier: 3 });
  });

  it("keeps comfort in tags — the cheer-up tag rides the filename", () => {
    const p = parsePath(root, `${root}/food/d5-coffee-comfort.png`);
    expect(p).toMatchObject({ tags: ["coffee", "comfort"] });
  });

  it("rejects files without the d<day>- prefix", () => {
    expect(parsePath(root, `${root}/odin/socks.jpg`)).toContain("d<day>");
  });

  it("rejects files not under a subject folder", () => {
    expect(parsePath(root, `${root}/d1-random.jpg`)).toContain("subject folder");
  });

  it("rejects unsupported extensions and absurd days", () => {
    expect(parsePath(root, `${root}/odin/d3-socks.gif`)).toContain("extension");
    expect(parsePath(root, `${root}/odin/d999-socks.jpg`)).toContain(
      "unlock day"
    );
  });

  it("multi-tag filenames split on dashes", () => {
    const p = parsePath(root, `${root}/scene/d2-rain-window-night.jpg`);
    expect(p).toMatchObject({ tags: ["rain", "window", "night"] });
  });
});

describe("PHOTO_REQUEST — asking for a pic never forces one", () => {
  it.each([
    "send me a pic",
    "send pics pls",
    "can you send me a photo?",
    "show me a selfie",
    "let me see a picture of you",
    "pic please",
    "take a photo for me",
    "gimme a pic",
  ])("flags %s as a request", (s) => {
    expect(PHOTO_REQUEST.test(s)).toBe(true);
  });

  it.each([
    "my dog just ate my socks",
    "did you see the game last night",
    "what did you eat for dinner",
    "I love your profile",
    "tell me about your day",
  ])("leaves %s alone", (s) => {
    expect(PHOTO_REQUEST.test(s)).toBe(false);
  });
});
