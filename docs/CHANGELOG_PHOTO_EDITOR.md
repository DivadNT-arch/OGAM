# Photo Editor Changelog

Running log for the photo-editor fork (branch `feature/photo-editor`, based on upstream v0.0.103).

## Phase 2: Remove (2026-11-10)

**What was built**
- **Remove** tool: paint over something, tap Remove, and LaMa fills the area in to match its surroundings. It runs on the phone's CPU through ONNX Runtime and works in airplane mode once the model is downloaded.
- **Editing models** card on the Edit tab. LaMa is 208 MB, Apache-2.0, and pinned to one Hugging Face commit. The download is SHA-256 checked, resumes if it was interrupted, and can be cancelled or deleted. The card shows storage used.
- **Edit history:** edits stack (each Remove builds on the previous result). **Undo edit** and **Redo edit** step through them. "Hold: before" shows the original.
- A progress overlay with **Cancel**, which stops the model run mid-way through ONNX Runtime's terminate flag.
- Low memory: if the phone doesn't have enough free memory for an edit, the app unloads the chat and image models (they reload when next used) and tries once more. If it still can't fit, it shows a clear message instead of crashing.
- The timing log records each Remove with its breakdown: model load, model run, decode, blend, encode and crop size.

**How it works: crop, process, paste back** (`RegionPipeline.kt`, shared by later tools)
1. Bounding box of the paint, computed from the strokes (no full-size mask is drawn).
2. 30% padding on each side, a square crop of at least 384 px, clamped to the photo.
3. The crop is scaled to 512 x 512. The mask is drawn directly at 512, slightly thicker so the model also rebuilds the object's soft edge.
4. LaMa runs on the 512 crop.
5. The result is scaled back to the crop's size.
6. It's blended in through a dilated, feathered mask (drawn small and scaled up with filtering), so only the painted area changes.
7. Colour matching is left for Phase 3.
- Edits run on the stored (raw) pixels. The painted strokes are mapped through the EXIF orientation, so rotated photos are never rotated in memory. The result keeps the original's orientation, date, location and camera tags.
- Each result is a new JPEG (quality 95) in the session folder. The original copy is never written to.

**Tests**
- `RegionPipelineTest.kt` (Robolectric, real Android graphics) checks that only the painted area changes, that the edge is feathered, that EXIF-rotated photos are edited where the user painted, and that unpainting works.
- `photoEditor.test.tsx` covers the full Remove flow: the model download prompt, Remove, edit undo/redo, and stacked edits.
- The LaMa input and output format (image 0..1, mask 1 = fill, output 0..255) was checked on the real model with ONNX Runtime before writing the engine.

**Known gaps**
- Large Removes on 48 MP photos re-encode the whole photo (about 1–2 s). Pixels outside the paint keep their values but go through JPEG once more at quality 95.
- Long edits don't use a foreground notification yet (planned for Phase 8). A Remove takes seconds, so this shouldn't matter yet.
- The ONNX Runtime library is arm64 only in this fork (other ABIs are excluded in `android/app/photo-editor.gradle`).

## Phase 1: Edit screen (2026-11-10)

**What was built**
- An **Edit** tab (Android only). It opens a photo from the system file picker, continues the current edit, or opens the timing log.
- **"Edit with Off Grid"** in the Android share sheet and in a gallery's Edit / Open with menu.
- An **editor screen** with:
  - pinch to zoom, two-finger pan, and a Move tool (one-finger pan, double-tap to reset zoom)
  - a brush and an eraser for the mask, with adjustable size; the brush stays the same size on screen at any zoom
  - undo, redo and clear for the mask
  - press-and-hold "before" (until Phase 2 there's no edit, so it only hides the mask)
  - **Save copy** and **Share**, plus a "Keep date and location" switch
  - a disabled tool row: Remove, Fill, Upscale, Background, Restyle, Retouch. Each says which phase it arrives in.
- **Foldable layout:** at 600 dp or wider (the inner screen), the tools sit in a side panel; the cover screen gets a bottom bar.
- An **Edit timing** screen that logs how long each operation took. It's stored on the phone only.

**How it works**
- When a photo is opened, it's copied byte for byte into app storage (`files/photo_editor/sessions/<id>/original.*`). The editor only ever works on that copy, so the original in the gallery is never opened for writing.
- The canvas shows a preview downscaled to 2048 px, with EXIF rotation applied. A 48 MP photo is never fully decoded in Phase 1.
- Mask strokes are stored in normalised image coordinates (0..1), so they don't depend on zoom, screen size or folding. Later phases rasterise them at full resolution.
- The session (photo paths, mask, undo/redo) is saved to AsyncStorage on every change. Folding or unfolding doesn't restart the activity (`configChanges` already covers it), and if Android closes the app in the background, the edit is restored next time.
- Saving always creates a new file in `Pictures/Off Grid Edits` through MediaStore. With "Keep date and location" off, the GPS and date EXIF tags are removed from the copy.
- Location: Android removes GPS data from photos unless the app holds `ACCESS_MEDIA_LOCATION` and asks for the original. The picker uses `ACTION_OPEN_DOCUMENT` (the newer photo picker always strips location), and the app requests that permission before picking.

**Files**
- New: `src/photoEditor/**`, `android/app/src/main/java/ai/offgridmobile/photoeditor/**`, `__tests__/integration/photoEditor/photoEditorPhase1.test.tsx`
- Upstream files touched (small, marked "photo editor"):
  - `src/navigation/AppNavigator.tsx` (Edit tab + share receiver)
  - `src/navigation/types.ts` (`EditTab`)
  - `android/.../MainApplication.kt` (register package)
  - `AndroidManifest.xml` (`EditShareActivity`, `ACCESS_MEDIA_LOCATION`)

**Known gaps**
- No AI tools yet. They arrive in Phases 2 to 8.
- HEIC photos: removing date and location isn't supported yet. Keeping them works.
- The repo's pre-push gate can't pass in this fork: `tsc` and a few voice/TTS tests fail on the unmodified v0.0.103 code because the private `pro/` module is missing. The editor's own files pass lint, `tsc`, dependency-cruiser, knip and their test.
