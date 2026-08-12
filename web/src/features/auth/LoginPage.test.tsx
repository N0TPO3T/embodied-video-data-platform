import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as accountApi from "../../auth/client/accountApi";
import { makeAccountPublic } from "../../auth/testFactories";
import { LoginPage } from "./LoginPage";

const TEST_PASSWORD = "test-password-admin";

vi.mock("../../auth/client/accountApi", async () => {
  const actual = await vi.importActual<
    typeof import("../../auth/client/accountApi")
  >("../../auth/client/accountApi");
  return { ...actual, login: vi.fn() };
});

afterEach(() => {
  vi.mocked(accountApi.login).mockReset();
});

describe("LoginPage", () => {
  it("submits a username and password exactly once", async () => {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn();
    vi.mocked(accountApi.login).mockResolvedValue({
      user: makeAccountPublic({
        role: "admin",
        teamId: undefined,
      }),
      homePath: "/admin",
    });
    render(
      <LoginPage
        navigate={vi.fn()}
        onAuthenticated={onAuthenticated}
      />,
    );

    await user.type(screen.getByLabelText("用户名"), "admin");
    await user.type(screen.getByLabelText("密码"), TEST_PASSWORD);
    await user.dblClick(screen.getByRole("button", { name: "登录" }));

    expect(accountApi.login).toHaveBeenCalledTimes(1);
    expect(accountApi.login).toHaveBeenCalledWith(
      "admin",
      TEST_PASSWORD,
    );
    expect(onAuthenticated).toHaveBeenCalledWith(
      expect.objectContaining({ homePath: "/admin" }),
    );
  });

  it("shows a safe authentication error and keeps the password out of the page", async () => {
    const user = userEvent.setup();
    vi.mocked(accountApi.login).mockRejectedValue(
      new accountApi.AccountApiError(
        401,
        "用户名或密码错误",
        "INVALID_CREDENTIALS",
      ),
    );
    render(
      <LoginPage
        navigate={vi.fn()}
        onAuthenticated={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("用户名"), "admin");
    await user.type(screen.getByLabelText("密码"), "wrong-pass");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "用户名或密码错误",
    );
    expect(screen.queryByText("wrong-pass")).not.toBeInTheDocument();
  });
});
