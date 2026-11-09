# Photo Editor — Architecture Notes (Phase 0)

Research was done on commit `0957b72` (v0.0.123-beta.1, matching upstream `off-grid-ai/OGAM`).
**Decision (David, 2026-11-09): the `feature/photo-editor` branch is based on upstream tag `v0.0.103`** (the last public release that builds without Off Grid's private `../shared` packages). In v0.0.103 only the local-dream engine exists (no stable-diffusion.cpp, see §1b).
No feature code has been changed. **The on-device parts of Phase 0 (build, install and benchmarks on the Fold) have not been done yet.** See §0.

---

## 0. Blocker: this version can't be built from public source

`package.json` depends on six local packages that are **not in this repository**:

```
"@offgrid/design": "file:../shared/packages/design"
"@offgrid/models": "file:../shared/packages/models"   (used by 76 source files)
"@offgrid/rag":    "file:../shared/packages/rag"
"@offgrid/speech": "file:../shared/packages/speech"
"@offgrid/sync":   "file:../shared/packages/sync"
"@offgrid/ui":     "file:../shared/packages/ui"
```

They live in a sibling `shared/` folder of Off Grid's private workspace. No public `off-grid-ai/shared` repo exists. A test `npm install` succeeds, but it leaves six broken links in `node_modules/@offgrid/`, so the JavaScript bundle can't build. The `pro/` submodule is private too, but the app has a stub for it (`src/bootstrap/proStub.js`), so that one isn't a blocker.

Checking the release tags upstream:

| Tag | Date | Private `../shared` deps |
|---|---|---|
| v0.0.103 | 2026-07-16 | **0** (last release that should build publicly) |
| v0.0.104-beta.1 | 2026-08-11 | 2 |
| v0.0.110 … v0.0.123 | | 5–6 |

So the brief's goal of "keep the fork mergeable with upstream" no longer holds as stated: upstream itself can't be built outside Off Grid's own workspace.

## 1. How React Native talks to the image engines (Android)

The app contains **two** separate diffusion engines.

### 1a. local-dream (MNN / QNN): the default image engine
- JS: `src/services/localDreamGenerator.ts` → `NativeModules.LocalDreamModule`.
- Native: `android/app/src/main/java/ai/offgridmobile/localdream/LocalDreamModule.kt`.
- The engine is a **prebuilt binary** checked into the repo: `android/app/src/main/jniLibs/arm64-v8a/libstable_diffusion_core.so`. It is not built from source here.
- Kotlin starts it as a **child process** (an HTTP server on `127.0.0.1`), then sends `POST /generate` with a JSON body and reads progress and preview images back over Server-Sent Events. Progress reaches JS as `LocalDreamProgress` events.
- With `--cpu` the server uses MNN. Turning on GPU is a per-request flag, `"use_opencl": true`. Without `--cpu` it uses QNN (Snapdragon NPU), which won't work on Tensor.

### 1b. stable-diffusion.cpp (ggml): the second, newer engine
- Compiled **inside the app** from source (MIT) via `android/app/src/main/cpp/CMakeLists.txt` and `scripts/prepare-video-runtime.sh`, pinned at `scripts/video/revision`. It is reached through JNI (`video-jni.cpp`, `native/video/common/VideoRuntime.hpp`) and `VideoGenerationModule.kt`.
- GPU paths: **Vulkan** (`SD_VULKAN ON`), OpenCL (Adreno-only loader) and Hexagon. Only Vulkan is relevant to a PowerVR GPU.
- Used for video and, via `backend: 'sd'`, for image generation with GGUF/checkpoint models.
- It already includes an in-process **Real-ESRGAN upscaler** (`nativeUpscalerOpen` / `nativeUpscale`), used today to sharpen video frames.
- It **only exists in v0.0.104 and later**, which are the blocked versions from §0.

## 2. img2img and inpaint: are they already compiled in?

**local-dream:** the engine supports them, but Off Grid doesn't use them.
- Strings in the bundled binary show img2img support (`denoise_strength`, VAE encoder tiling, and "img2img disabled unless --cpu", meaning img2img works in MNN/CPU mode).
- Upstream local-dream's `RequestParser.hpp` accepts `"image"` (base64), `"mask"` and `"denoise_strength"` on `/generate`.
- Off Grid's request builder (`LocalDreamModule.kt`, about line 640) never sends these fields. Adding them is a small, contained change.
- img2img needs `vae_encoder.mnn` in the model folder. Off Grid already passes it to the binary when it exists.
- We still need to confirm on the device that the **bundled** binary honours `"mask"`. The newest upstream code does, but the bundled build's version isn't recorded.
- **NSFW filter:** the binary only runs its safety checker when it is given a safety-checker path. Off Grid never passes one, so edit results won't be filtered. No change is needed.

**stable-diffusion.cpp:** the library itself supports img2img, inpainting (with a mask and strength), any size that is a multiple of 64, ControlNet and ESRGAN. Off Grid only feeds it an init image for "animate this photo". Exposing mask and strength would mean editing Off Grid's JNI bridge, or better, adding our own small JNI file in a separate folder.

## 3. Where models live and how they're downloaded

- Image models: `<app documents>/image_models/<modelId>/` (`src/services/modelManager/index.ts`).
- The model browser lists zip files from Hugging Face repos `xororz/sd-mnn` (CPU/GPU) and `xororz/sd-qnn` (NPU), then downloads and unzips them (`huggingFaceModelBrowser.ts`, `imageDownloadActions.ts`, `modelManager/download.ts`).
- Downloads go through a native WorkManager/OkHttp download module (`android/.../download/`). We can reuse this for LaMa, segmentation and face models.

## 4. Licenses

| Component | License | Notes for us |
|---|---|---|
| Off Grid (this repo) | MIT | |
| **local-dream** (the bundled binary) | **CC BY-NC 4.0** | Not open source in the usual sense: **non-commercial only**. Fine for personal use, but it is *not* MIT. Any code we take from it inherits NC. |
| stable-diffusion.cpp | MIT | |
| MNN | Apache-2.0 | Inside the local-dream binary |
| LaMa (advimman/lama) | Apache-2.0 | |
| Real-ESRGAN | BSD-3-Clause | |
| GFPGAN | Apache-2.0 (some third-party parts under their own licenses) | Preferred face model if we want to avoid NC |
| CodeFormer | S-Lab License 1.0, **non-commercial** | Fine for personal use |
| BiRefNet | MIT | |
| SD 1.5 model weights (xororz/sd-mnn) | CreativeML OpenRAIL-M | Use restrictions, no NC |
| Qualcomm QNN libs (bundled) | Qualcomm proprietary | Not used on Tensor |
| ONNX Runtime / LiteRT (candidates for LaMa) | MIT / Apache-2.0 | |

## 5. Risks specific to the Pixel Fold (Tensor + PowerVR)

1. **local-dream's "GPU" mode may not work at all.** It relies on MNN OpenCL. Pixel phones have historically not exposed `libOpenCL.so` to apps. Off Grid has a workaround for Mali-GPU Pixels (`libGLES_mali.so`) that doesn't apply to PowerVR. Expect local-dream to run **CPU-only** on the Fold until a benchmark proves otherwise.
2. **Vulkan (stable-diffusion.cpp) is the most plausible GPU path** on PowerVR, but it hasn't been tested. Off Grid carries several Vulkan workaround patches written for other GPUs.
3. The 512×512 limit belongs to local-dream's MNN path. stable-diffusion.cpp doesn't have it. Crop → process → paste back (§5.2 of the brief) is still the right approach for speed, either way.

## 6. Benchmarks

Not run yet: they need the phone connected to a computer with the Android build tools. See the plan in the reply that went with this file.
