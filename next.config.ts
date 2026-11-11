import type { NextConfig } from "next";

const NATIVE = [
  "./node_modules/ffmpeg-static/ffmpeg",
  "./node_modules/onnxruntime-node/bin/napi-v*/linux/x64/libonnxruntime.so*",
  "./node_modules/onnxruntime-node/bin/napi-v*/linux/x64/libonnxruntime_providers_shared.so",
];

const nextConfig: NextConfig = {
  // Native/binary packages stay out of the bundle and are loaded from node_modules at runtime.
  serverExternalPackages: ["onnxruntime-node", "ffmpeg-static"],
  // Binaries loaded at runtime (not via import), so the tracer can't find them on its own.
  outputFileTracingIncludes: {
    "/api/worker": NATIVE,
    "/api/voice-preview": NATIVE,
  },
  // Only the Linux x64 CPU build of ONNX Runtime is needed (the GPU providers are ~300 MB).
  outputFileTracingExcludes: {
    "*": [
      "./node_modules/onnxruntime-node/bin/napi-v*/darwin/**",
      "./node_modules/onnxruntime-node/bin/napi-v*/win32/**",
      "./node_modules/onnxruntime-node/bin/napi-v*/linux/arm64/**",
      "./node_modules/onnxruntime-node/bin/napi-v*/linux/x64/libonnxruntime_providers_cuda*",
      "./node_modules/onnxruntime-node/bin/napi-v*/linux/x64/libonnxruntime_providers_tensorrt*",
      "./node_modules/@img/**",
    ],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
