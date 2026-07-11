import { describe, expect, mock, test } from "bun:test";
import {
  invokeMechanicJobAction,
  type MechanicJobAction,
  mechanicJobAction,
} from "./mechanic-job-actions";

describe("mechanicJobAction — button per status", () => {
  test("approved shows Start", () => {
    expect(mechanicJobAction("approved")).toEqual({
      label: "Start",
      busyLabel: "Starting…",
      to: "in_progress",
    });
  });

  test("legacy 'scheduled' canonicalizes to approved → Start", () => {
    expect(mechanicJobAction("scheduled")?.to).toBe("in_progress");
  });

  test("in_progress shows Complete", () => {
    expect(mechanicJobAction("in_progress")).toEqual({
      label: "Complete",
      busyLabel: "Completing…",
      to: "completed",
    });
  });

  test.each([
    "draft",
    "estimated",
    "declined",
    "completed",
    "cancelled",
  ])("%s shows no button", (status) => {
    expect(mechanicJobAction(status)).toBeNull();
  });

  test("unknown status shows no button", () => {
    expect(mechanicJobAction("garbage")).toBeNull();
  });
});

describe("invokeMechanicJobAction — complete soft-prompts for diagnosis", () => {
  const start: MechanicJobAction = {
    label: "Start",
    busyLabel: "Starting…",
    to: "in_progress",
  };
  const complete: MechanicJobAction = {
    label: "Complete",
    busyLabel: "Completing…",
    to: "completed",
  };

  test("start transitions immediately, no prompt", async () => {
    const transition = mock(async () => {});
    const ask = mock(async () => "never");
    await invokeMechanicJobAction(
      start,
      { confirmedDiagnosis: null },
      transition,
      ask,
    );
    expect(ask).not.toHaveBeenCalled();
    expect(transition).toHaveBeenCalledWith("in_progress");
  });

  test("complete without diagnosis prompts; text is passed through", async () => {
    const transition = mock(async () => {});
    const ask = mock(async () => "  bad alternator  ");
    await invokeMechanicJobAction(
      complete,
      { confirmedDiagnosis: null },
      transition,
      ask,
    );
    expect(ask).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith("completed", "bad alternator");
  });

  test("blank prompt completes without a diagnosis (skippable)", async () => {
    const transition = mock(async () => {});
    const ask = mock(async () => "");
    await invokeMechanicJobAction(
      complete,
      { confirmedDiagnosis: null },
      transition,
      ask,
    );
    expect(transition).toHaveBeenCalledWith("completed", undefined);
  });

  test("cancelling the prompt backs out of completing", async () => {
    const transition = mock(async () => {});
    const ask = mock(async () => null);
    await invokeMechanicJobAction(
      complete,
      { confirmedDiagnosis: null },
      transition,
      ask,
    );
    expect(transition).not.toHaveBeenCalled();
  });

  test("existing diagnosis skips the prompt", async () => {
    const transition = mock(async () => {});
    const ask = mock(async () => "never");
    await invokeMechanicJobAction(
      complete,
      { confirmedDiagnosis: "already recorded" },
      transition,
      ask,
    );
    expect(ask).not.toHaveBeenCalled();
    expect(transition).toHaveBeenCalledWith("completed");
  });
});
