import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/binary packages stay out of the bundle and are loaded from node_modules at runtime.
  serverExternalPackages: ["onnxruntime-node", "ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/worker": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/voice-preview": ["./node_modules/ffmpeg-static/ffmpeg"],
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
