"use client";

import { createRealtimeClient } from "@neon/realtime/client";
import { RealtimeProvider } from "@neon/realtime-react";
import { useState, type ReactNode } from "react";

export function RealtimeRoot({ url, children }: { url: string; children: ReactNode }) {
  const [client] = useState(() => createRealtimeClient({ url }));
  return <RealtimeProvider client={client}>{children}</RealtimeProvider>;
}
