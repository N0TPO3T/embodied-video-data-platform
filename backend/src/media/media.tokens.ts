import type { MediaCommandRunner } from "./media-command-runner.js";

export const MEDIA_COMMAND_RUNNER = Symbol("MEDIA_COMMAND_RUNNER");
export type MediaCommandRunnerProvider = MediaCommandRunner;
