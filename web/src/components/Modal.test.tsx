import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { Modal } from "./Modal";

function ModalHarness() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <button ref={triggerRef} onClick={() => setOpen(true)}>
        打开表单
      </button>
      <Modal
        open={open}
        title="邀请成员"
        onClose={() => setOpen(false)}
        returnFocusRef={triggerRef}
        initialFocusRef={inputRef}
      >
        <label>
          姓名
          <input ref={inputRef} />
        </label>
        <button type="button">弹窗内按钮</button>
      </Modal>
    </div>
  );
}

describe("Modal", () => {
  it("opens with initial focus and closes with Escape while restoring focus", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "打开表单" }));
    expect(screen.getByRole("dialog", { name: "邀请成员" })).toBeVisible();
    expect(screen.getByLabelText("姓名")).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");

    await user.tab();
    expect(screen.getByRole("button", { name: "弹窗内按钮" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "关闭邀请成员" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "弹窗内按钮" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开表单" })).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps content clicks inside and closes from the backdrop or close button", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);

    await user.click(screen.getByRole("button", { name: "打开表单" }));
    await user.click(screen.getByRole("button", { name: "弹窗内按钮" }));
    expect(screen.getByRole("dialog", { name: "邀请成员" })).toBeVisible();

    const backdrop = screen.getByRole("dialog").parentElement!;
    await user.click(backdrop);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "打开表单" }));
    await user.click(screen.getByRole("button", { name: "关闭邀请成员" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
