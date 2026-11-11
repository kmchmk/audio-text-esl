import { notFound } from "next/navigation";
import { connection } from "next/server";

import { requireSeededUser } from "@/lib/auth/server";
import { getConversation, getDraftLines, listCharacters } from "@/lib/data";
import { realtimeUrl, sealLive } from "@/lib/live";

import { Editor } from "./editor";
import { RealtimeRoot } from "./realtime-root";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const user = await requireSeededUser();
  const meta = await getConversation(user.id, id);
  if (!meta) notFound();
  const [lines, characters, sealedDraft, sealedMeta, sealedGenerations] = await Promise.all([
    getDraftLines(user.id, id),
    listCharacters(user.id),
    sealLive("draft", user.id, id),
    sealLive("meta", user.id, id),
    sealLive("generations", user.id, id),
  ]);
  return (
    <RealtimeRoot url={realtimeUrl()}>
      <Editor
        userId={user.id}
        initialMeta={meta}
        initialLines={lines}
        characters={characters}
        sealedDraft={sealedDraft}
        sealedMeta={sealedMeta}
        sealedGenerations={sealedGenerations}
      />
    </RealtimeRoot>
  );
}
