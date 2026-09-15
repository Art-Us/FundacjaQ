-- Powiat/voivodeship are optional at every call site (inline "+ Nowa gmina"
-- quick-create only supplies a name), but the column was left NOT NULL —
-- align the schema with how the app actually creates gminy.
ALTER TABLE "Gmina" ALTER COLUMN "powiat" DROP NOT NULL;
ALTER TABLE "Gmina" ALTER COLUMN "voivodeship" DROP NOT NULL;
