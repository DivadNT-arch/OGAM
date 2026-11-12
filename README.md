# Editing models (photo editor fork)

Model files that the photo editor downloads. Kept on this branch only, apart from the app code. Files are split into parts under GitHub's 100 MB limit; the app joins them and checks the SHA-256.

## lama1024/lama_1024_fp32.onnx

**lama_1024_fp32.onnx**: the LaMa inpainting model (big-lama) exported to ONNX at a fixed 1024 x 1024 input, for the Remove tool on large areas.

- Weights: big-lama by Samsung AI Center (advimman/lama), Apache-2.0. Source checkpoint: huggingface.co/smartywu/big-lama, commit 05cb2be7f8dbe6ca7c6e78f4fc827a4b2baaa4a9.
- Export recipe: Carve-Photos/lama (Apache-2.0), commit f5fb39a, generator only, opset 17. The same process at 512 matches Carve/LaMa-ONNX lama_fp32.onnx (max output difference 0.002 on a 0-255 scale).
- Inputs: `image` [1,3,1024,1024] RGB 0..1, `mask` [1,1,1024,1024] (1 = fill). Output: `output` [1,3,1024,1024] RGB 0..255.
- SHA-256: 923d45aa2dcd98d43b98597c88118dc6bb8a0bccec0b63a6dd39df45b1c9fd4c

Licensed under the Apache License 2.0 (https://www.apache.org/licenses/LICENSE-2.0). This file is a format conversion of the original weights, with no retraining.

Parts (SHA-256):

    a3f8664eea5b39378b2be0be5c10feb7ac00866de8b34f284c6b91d0177775df  lama1024/lama_1024_fp32.onnx.part0
    2003bcc5c98c70f37aa283f667989f3e250063d589c0ee1a51f2aac3f57ecab5  lama1024/lama_1024_fp32.onnx.part1
    492b822d19c4f48a327bc48d810f1319c081890f69e84929c8de9cf2bb2a125e  lama1024/lama_1024_fp32.onnx.part2

## esrgan/realesr_general_x4v3.onnx

Real-ESRGAN realesr-general-x4v3 (xinntao/Real-ESRGAN, BSD-3-Clause), for the Upscale tool. 4x upscaler, dynamic input size.

- Source weights: github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth (SHA-256 8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292).
- Exported to ONNX (opset 17) with the SRVGGNetCompact architecture written out directly; weights loaded with weights_only=True.
- Input `input` [1,3,H,W] RGB 0..1. Output `output` [1,3,4H,4W] RGB 0..1.
- Size: 4866396 bytes. SHA-256: 3439a9e4cd26c4cdfff28f82f00411a7a4f06e7f72a1efdc664479f1e2bf0690

Real-ESRGAN is licensed under the BSD 3-Clause License, Copyright (c) 2021, Xintao Wang.
