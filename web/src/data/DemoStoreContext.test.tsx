import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DemoStoreProvider, useDemoStore } from "./DemoStoreContext";

function StoreProbe() {
  const { currentUser, loginAs } = useDemoStore();
  return (
    <div>
      <span>{currentUser.name}</span>
      <button onClick={() => loginAs("admin")}>switch</button>
    </div>
  );
}

describe("DemoStoreProvider", () => {
  it("re-renders consumers when the store state changes", async () => {
    const user = userEvent.setup();
    render(
      <DemoStoreProvider>
        <StoreProbe />
      </DemoStoreProvider>,
    );

    expect(screen.getByText("林晓雨")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "switch" }));
    expect(screen.getByText("陈屿")).toBeVisible();
  });

  it("requires the hook to be used within the provider", () => {
    expect(() => render(<StoreProbe />)).toThrow(
      "useDemoStore must be used inside DemoStoreProvider",
    );
  });
});
