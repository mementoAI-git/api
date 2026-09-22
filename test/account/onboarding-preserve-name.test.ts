import {afterAll, afterEach, beforeAll, describe, expect, it} from "vitest";
import {onboarding} from "../../src/module/api/user/service";
import User from "../../src/module/database/model/user";
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from "../helpers/database";
import {createUserFixture} from "../helpers/factories";

describe("onboarding preserves user names", () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it("does not wipe out first_name or last_name when payload omits them", async () => {
    const user = await createUserFixture({
      first_name: "Ridhaan",
      last_name: "Malachy",
      nickname: "Rid",
    });

    await onboarding(
      {
        motivation: "preserve_memories",
        current_priority: ["everyday_life"],
        priority_dimensions: ["everyday_life"],
        step: 4,
      } as any,
      user.id,
    );

    const refreshed = await User.findById(user.id);
    expect(refreshed?.first_name).toBe("Ridhaan");
    expect(refreshed?.last_name).toBe("Malachy");
    expect(refreshed?.nickname).toBe("Rid");
  });

  it("does not wipe out first_name or last_name when empty strings are supplied", async () => {
    const user = await createUserFixture({
      first_name: "Ridhaan",
      last_name: "Malachy",
    });

    await onboarding(
      {
        first_name: "",
        last_name: "",
        nickname: "",
        step: 4,
      } as any,
      user.id,
    );

    const refreshed = await User.findById(user.id);
    expect(refreshed?.first_name).toBe("Ridhaan");
    expect(refreshed?.last_name).toBe("Malachy");
  });
});
