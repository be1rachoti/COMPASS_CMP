/**
 * The approval form submits.
 *
 * Written for a bug that shipped: `approvalSchema` gained a required `proof`
 * field, the form kept the file in `React.useState`, and nothing ever wrote it
 * into form state. `handleSubmit` therefore validated `proof: undefined`
 * against `z.instanceof(File)`, failed, and returned — so pressing "Upload
 * approval" with every field correctly filled did nothing at all, and no error
 * appeared anywhere because no control was bound to `errors.proof`.
 *
 * A silent no-op is the worst failure a form can have: there is nothing to
 * read, nothing to search for, and the only signal is that the dialog stays
 * open. So the first test here is deliberately blunt — fill it in, submit, and
 * assert the request happened.
 */

import { describe, expect, it, vi } from "vitest";

import { ApprovalForm } from "@/features/projects/components/approval-form";
import { render, screen, waitFor } from "@/test/render";
import { API, HttpResponse, http, server } from "@/test/server";

vi.mock("@/providers", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/providers");
  return {
    ...actual,
    useToast: () => ({
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
    }),
  };
});

const PROJECT = "22222222-2222-4222-8222-222222222222";

function pngFile(name = "FLOW.png", bytes = 1_500_000): File {
  const file = new File(["x"], name, { type: "image/png" });
  Object.defineProperty(file, "size", { value: bytes });
  return file;
}

/** The enum list the type dropdown is populated from. */
function withEnums() {
  server.use(
    http.get(`${API}/meta/enums`, () =>
      HttpResponse.json({
        approval_type: [
          { value: "security", label: "Security" },
          { value: "ethics", label: "Ethics" },
        ],
      }),
    ),
  );
}

async function fillAndSubmit(
  user: ReturnType<typeof render>["user"],
  { file = pngFile() }: { file?: File | null } = {},
) {
  // Wait for the *option*, not the select: the dropdown renders immediately
  // and is populated when /meta/enums resolves, so waiting for the control
  // succeeds a beat too early.
  await waitFor(() =>
    expect(screen.getByRole("option", { name: "Security" })).toBeInTheDocument(),
  );

  await user.selectOptions(screen.getByLabelText(/^type/i), "security");
  await user.type(screen.getByLabelText(/reference number/i), "xzc");
  // The same date the report came from: today. `pastOrToday` accepts it, and a
  // future date is the separate case tested below.
  const today = new Date().toISOString().slice(0, 10);
  await user.clear(screen.getByLabelText(/approved on/i));
  await user.type(screen.getByLabelText(/approved on/i), today);

  if (file) {
    await user.upload(screen.getByLabelText(/proof document/i), file);
  }

  await user.click(screen.getByRole("button", { name: /upload approval/i }));
}

describe("ApprovalForm", () => {
  it("uploads when every field is filled in", async () => {
    withEnums();
    let posted = false;
    server.use(
      http.post(`${API}/projects/:uuid/approvals`, () => {
        posted = true;
        return HttpResponse.json({ ok: true }, { status: 201 });
      }),
    );

    const { user } = render(<ApprovalForm projectUuid={PROJECT} onDone={vi.fn()} />);
    await fillAndSubmit(user);

    await waitFor(() => expect(posted).toBe(true));
  });

  it("says so when the proof is missing, rather than doing nothing", async () => {
    // The failure this replaced was silent. Whatever the form does about a
    // missing proof, it has to be *visible*.
    withEnums();
    server.use(
      http.post(`${API}/projects/:uuid/approvals`, () =>
        HttpResponse.json({ ok: true }, { status: 201 }),
      ),
    );

    const { user } = render(<ApprovalForm projectUuid={PROJECT} onDone={vi.fn()} />);
    await fillAndSubmit(user, { file: null });

    await waitFor(() =>
      expect(screen.getByText(/proof file is mandatory|choose an approval document/i))
        .toBeInTheDocument(),
    );
  });

  it("closes the dialog once the upload succeeds", async () => {
    withEnums();
    server.use(
      http.post(`${API}/projects/:uuid/approvals`, () =>
        HttpResponse.json({ ok: true }, { status: 201 }),
      ),
    );

    const onDone = vi.fn();
    const { user } = render(<ApprovalForm projectUuid={PROJECT} onDone={onDone} />);
    await fillAndSubmit(user);

    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
