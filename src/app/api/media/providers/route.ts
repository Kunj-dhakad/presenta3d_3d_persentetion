import { api } from "@/server/http/api";
import { mediaProviderStatus } from "@/server/media/providers";

export const GET = api(async () => ({ providers: mediaProviderStatus() }));
