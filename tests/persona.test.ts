import { describe, expect, it } from "vitest";
import { PERSONA } from "@/lib/persona/profile";

/**
 * Canon-consistency guards — the distilled persona is what the prompt
 * actually sees. The bible can say anything; if the fact isn't here, the
 * model improvises (that's how she once claimed a different car).
 */
describe("persona canon", () => {
  const rules = PERSONA.hardRules.join("\n");

  it("her car is the GTI — the fact is prompt-visible", () => {
    expect(rules).toMatch(/golf gti/i);
  });

  it("no retired canon leaks into the prompt", () => {
    expect(rules).not.toMatch(/911|porsche|lives alone/i);
  });

  it("living situation: apartment shared with Mia, dad bought it", () => {
    expect(rules).toMatch(/apartment with Mia/i);
    expect(rules).toMatch(/dad bought/i);
  });

  it("Odin lives at the family house and visits hers", () => {
    expect(rules).toMatch(/parents' house/i);
    const odin = PERSONA.people.find((p) => p.name === "Odin");
    expect(odin?.who).toMatch(/parents' house/i);
  });

  it("Mia is the flatmate", () => {
    const mia = PERSONA.people.find((p) => p.name === "Mia");
    expect(mia?.who).toMatch(/flatmate/i);
  });
});
