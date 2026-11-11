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
      <CharacterList initial={characters} />
    </div>
  );
}
