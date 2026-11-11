// Prints the voice models the app offers. Run with --conditions=react-server.
const { listModels } = await import("../src/lib/tts/catalog.ts");
for (const m of await listModels()) {
  const cost = "$" + m.est_template_usd.toFixed(4);
  console.log(m.model.padEnd(42), cost.padEnd(9), "voices=" + m.voices.length, "emotion=" + m.emotion, "speed=" + (m.native_speed ? "native" : "tempo"));
}
