import { api } from "@/server/http/api";
import { publicConfigStatus } from "@/server/env";
import { mediaProviderStatus } from "@/server/media/providers";

/** Non-secret configuration status for the UI. Never includes keys or credentialed URLs. */
export const GET = api(async () => ({ config: publicConfigStatus(), media: mediaProviderStatus() }));
