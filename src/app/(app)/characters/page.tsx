import { connection } from "next/server";

import { requireSeededUser } from "@/lib/auth/server";
import { listCharacters } from "@/lib/data";

import { CharacterList } from "./character-list";

export default async function CharactersPage() {
  await connection();
  const user = await requireSeededUser();
  const characters = await listCharacters(user.id);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Characters</h1>
        <p className="text-sm text-muted">
          Your speakers. Editing a character creates a new version, so older audio keeps a record of how it sounded.
        </p>
      </div>
      <div className="card space-y-1 p-4 text-sm">
        <p className="font-medium">Choosing voices</p>
        <ul className="list-disc space-y-0.5 pl-5 text-muted">
          <li>
            <span className="text-fg">Free voices are adults only.</span> The starter Son and Daughter use free adult voices so the demo costs
            nothing.
          </li>
          <li>
            <span className="text-fg">Child voices cost a little:</span> MiniMax has girls and one boy; Fish Audio has a girl only (no boy
            voice exists there).
          </li>
          <li>
            <span className="text-fg">Emotions only work with some voices</span> (marked &quot;emotions&quot;). With others, the emotion you pick is
            ignored.
          </li>
          <li>Press ▶ Preview to hear a voice before saving. Paid previews cost a fraction of a baht, once per voice.</li>
        </ul>
      </div>
      <CharacterList initial={characters} />
    </div>
  );
}
