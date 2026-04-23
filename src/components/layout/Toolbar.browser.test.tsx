import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { renderWithRepo } from "../../test/renderWithRepo";
import { Toolbar } from "./Toolbar";
import { Toasts } from "./Toasts";

const REPO = "/repo";

describe("Toolbar fetch → Base UI Toast pipeline", () => {
  it("calls gitApi.fetch and surfaces a success toast", async () => {
    renderWithRepo(
      <>
        <Toolbar />
        <Toasts />
      </>,
      { initialTab: { path: REPO } },
    );

    const fetchBtn = screen.getByRole("button", { name: /^Fetch/i });
    await userEvent.click(fetchBtn);

    await waitFor(() => {
      expect(window.__gitApiMock.api.fetch).toHaveBeenCalledWith({
        all: true,
        prune: true,
      });
    });

    // Toast renders "Fetched" via Base UI Toast.Title, pulling from
    // toastObject.title set by useUI.toast("success", "Fetched").
    await waitFor(() => {
      expect(screen.getByText("Fetched")).not.toBeNull();
    });
  });
});
