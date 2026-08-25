/**
 * The gates, and the session warning.
 *
 * The first block asserts a property rather than a behaviour, and it is the
 * more important of the two: **`<Can>` reads the server's answer and never
 * derives one.** A test that stubbed `me.nav` and then asserted the same rule
 * the component computes would pass while both copies drifted from the API
 * together. So these check that changing `nav` changes what renders, and that
 * nothing renders on the strength of the role alone.
 */

import { describe, expect, it, vi } from "vitest";

import { Can, RequireFullSession, RequireRole } from "@/components/security/can";
import { SessionWarning } from "@/components/security/session-warning";
import { makeMe } from "@/test/fixtures";
import { render, screen, waitFor } from "@/test/render";
import type { Me } from "@/types";

const refresh = vi.fn();
const signOut = vi.fn();
let currentMe: Me | null = makeMe();

vi.mock("@/providers", () => ({
  useAuth: () => ({
    me: currentMe,
    isLoading: false,
    isResolved: true,
    needsMfa: false,
    role: currentMe?.role ?? null,
    can: (section: string) => Boolean(currentMe?.nav.includes(section)),
    refresh,
    signOut,
  }),
}));

describe("Can", () => {
  it("renders when the server put the section in nav", () => {
    currentMe = makeMe({ nav: ["dashboard", "users"] });
    render(
      <Can see="users">
        <button>Invite a colleague</button>
      </Can>,
    );
    expect(screen.getByRole("button", { name: /invite/i })).toBeInTheDocument();
  });

  it("renders nothing when it did not", () => {
    currentMe = makeMe({ nav: ["dashboard"] });
    render(
      <Can see="users">
        <button>Invite a colleague</button>
      </Can>,
    );
    expect(screen.queryByRole("button", { name: /invite/i })).not.toBeInTheDocument();
  });

  it("follows nav rather than the role", () => {
    // The point of the whole module. An admin whose nav does not include
    // `audit` cannot see the audit control - because the server said so, and
    // the client does not get a second opinion.
    currentMe = makeMe({ role: "admin", nav: ["dashboard"] });
    render(
      <Can see="audit">
        <span>Audit trail</span>
      </Can>,
    );
    expect(screen.queryByText("Audit trail")).not.toBeInTheDocument();
  });

  it("renders a fallback where absence would read as a bug", () => {
    currentMe = makeMe({ nav: [] });
    render(
      <Can see="users" fallback={<span>—</span>}>
        <span>12</span>
      </Can>,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders nothing when there is no session at all", () => {
    currentMe = null;
    render(
      <Can see="dashboard">
        <span>Dashboard</span>
      </Can>,
    );
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
  });
});

describe("RequireRole", () => {
  it("gates on role for the actions nav cannot express", () => {
    // A DCO reads the project list and may not upload an approval. Both are the
    // projects section, so nav cannot distinguish them.
    currentMe = makeMe({ role: "dco" });
    const { rerender } = render(
      <RequireRole roles={["dpo", "admin"]}>
        <button>Upload approval</button>
      </RequireRole>,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    currentMe = makeMe({ role: "dpo" });
    rerender(
      <RequireRole roles={["dpo", "admin"]}>
        <button>Upload approval</button>
      </RequireRole>,
    );
    expect(screen.getByRole("button", { name: /upload/i })).toBeInTheDocument();
  });
});

describe("RequireFullSession", () => {
  it("treats a pre-MFA session as not signed in", () => {
    // Between password and MFA the server issues a session that authorises
    // exactly one route. Code that reads "me is not null" as "signed in" is
    // wrong in that window, and that window is where a stolen password lives.
    currentMe = makeMe({ mfa_verified: false });
    render(
      <RequireFullSession>
        <span>Project list</span>
      </RequireFullSession>,
    );
    expect(screen.queryByText("Project list")).not.toBeInTheDocument();
  });
});

describe("SessionWarning", () => {
  const inSeconds = (n: number) => new Date(Date.now() + n * 1000).toISOString();

  it("stays out of the way while there is time left", () => {
    currentMe = makeMe({ session_expires_at: inSeconds(3600) });
    render(<SessionWarning />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("warns inside the last two minutes", () => {
    currentMe = makeMe({ session_expires_at: inSeconds(90) });
    render(<SessionWarning />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/session ends in/i)).toBeInTheDocument();
  });

  it("says unsaved work will be lost, which is the actual consequence", () => {
    currentMe = makeMe({ session_expires_at: inSeconds(60) });
    render(<SessionWarning />);
    expect(screen.getByText(/unsaved will be lost/i)).toBeInTheDocument();
  });

  it("is announced assertively, not merely drawn", () => {
    currentMe = makeMe({ session_expires_at: inSeconds(60) });
    render(<SessionWarning />);
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
  });

  it("only refreshes when the user asks", async () => {
    // There is deliberately no heartbeat: a timer that pings the API defeats
    // the idle timeout entirely - the session outlives the person.
    refresh.mockClear();
    currentMe = makeMe({ session_expires_at: inSeconds(60) });
    const { user } = render(<SessionWarning />);

    expect(refresh).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /stay signed in/i }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("offers a sign-out, so leaving is as easy as staying", async () => {
    signOut.mockClear();
    currentMe = makeMe({ session_expires_at: inSeconds(60) });
    const { user } = render(<SessionWarning />);

    await user.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
  });

  it("a dismissal applies to this session, not the browser", async () => {
    currentMe = makeMe({ session_expires_at: inSeconds(60) });
    const { user, rerender } = render(<SessionWarning />);

    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // A refresh moves the expiry. The next time that session nears its end the
    // warning is due again.
    currentMe = makeMe({ session_expires_at: inSeconds(59) });
    rerender(<SessionWarning />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("says nothing when there is no session", () => {
    currentMe = null;
    render(<SessionWarning />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
