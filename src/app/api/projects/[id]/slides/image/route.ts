import { api, HttpError } from "@/server/http/api";
import { getOwnedProject } from "@/server/services/projects";
import { activeProjectJob } from "@/server/jobs/runner";
import { loadDeck, saveDeck } from "@/server/deck/store";
import { ImagePainter } from "@/server/deck/cine-images";
import { assertPictureSlide, MAX_SLIDE_IMAGE_BYTES, needsPainting, promptFor, slidesView, storeSlideImage, withAiImage, withOwnImage } from "@/server/deck/slide-edit";

type P = { id: string };

/** The slide (0-based) from ?index=. */
function indexOf(req: Request): number {
  const raw = new URL(req.url).searchParams.get("index") ?? "";
  const n = Number(raw);
  if (!/^\d{1,3}$/.test(raw) || n > 199) throw new HttpError(400, "Which slide?", "VALIDATION");
  return n;
}

/** The request body as bytes, at most `max` (the picture itself, sent as the body). */
async function readBytes(req: Request, max: number): Promise<Uint8Array> {
  const tooBig = () => new HttpError(413, `The picture is too large. Use one under ${Math.round(max / 1024 / 1024)} MB.`, "PAYLOAD_TOO_LARGE");
  if (Number(req.headers.get("content-length") ?? "0") > max) throw tooBig();
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "Choose a picture to upload.", "VALIDATION");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw tooBig();
    }
    chunks.push(value);
  }
  if (!size) throw new HttpError(400, "Choose a picture to upload.", "VALIDATION");
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

async function ready(userId: string, projectId: string) {
  const project = await getOwnedProject(userId, projectId);
  if (await activeProjectJob(project.id)) throw new HttpError(409, "Wait until the presentation has finished generating.", "JOB_RUNNING");
  return project;
}

/**
 * Put the presenter's own picture on a cinematic slide (?index=; the image is the body: PNG, JPG or
 * WebP up to 5 MB). It stays when the AI edits the deck, until DELETE puts the AI picture back.
 */
export const POST = api<P>(
  async ({ req, user, params }) => {
    const project = await ready(user.id, params.id);
    const index = indexOf(req);
    const deck = await loadDeck(project.id);
    assertPictureSlide(deck, index); // checked before anything is stored
    const image = await storeSlideImage(project.id, await readBytes(req, MAX_SLIDE_IMAGE_BYTES));
    const saved = await saveDeck(project.id, withOwnImage(deck, index, image), `Slide ${index + 1}: own picture`);
    if (saved.build.status !== "succeeded") throw new HttpError(500, "The picture was saved, but the preview could not be rebuilt.", "BUILD_FAILED");
    return { ...slidesView(saved.deck), build: saved.build };
  },
  { rateLimit: { bucket: "build", perMinute: 20 } },
);

/** Back to the AI picture on a cinematic slide (?index=): the one replaced, or a new one painted from the slide's words. */
export const DELETE = api<P>(
  async ({ req, user, params }) => {
    const project = await ready(user.id, params.id);
    const index = indexOf(req);
    const deck = await loadDeck(project.id);
    let painted: string | undefined;
    if (needsPainting(deck, index)) {
      try {
        painted = await new ImagePainter(project.id).paint(promptFor(deck, index), "medium", AbortSignal.timeout(90_000));
      } catch {
        throw new HttpError(502, "The AI picture could not be made. Please try again.", "PICTURE_FAILED");
      }
    }
    const next = withAiImage(deck, index, painted);
    if (!next) return { ...slidesView(deck), build: null };
    const saved = await saveDeck(project.id, next, `Slide ${index + 1}: AI picture`);
    if (saved.build.status !== "succeeded") throw new HttpError(500, "The picture was saved, but the preview could not be rebuilt.", "BUILD_FAILED");
    return { ...slidesView(saved.deck), build: saved.build };
  },
  { rateLimit: { bucket: "build", perMinute: 20 } },
);
