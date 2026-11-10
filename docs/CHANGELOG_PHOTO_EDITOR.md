# Photo Editor Changelog

Running log for the photo-editor fork (branch `feature/photo-editor`, based on upstream v0.0.103).

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
