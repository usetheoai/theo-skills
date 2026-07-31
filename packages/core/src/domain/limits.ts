/** Centralized validation limits (DRY) — frontmatter + zip payload guards. */

// Frontmatter field limits (AgentSkills spec).
export const MAX_NAME_LENGTH = 64;
export const MAX_DESCRIPTION_LENGTH = 1024;
/** Categoria é rótulo de filtro, não texto — cabe numa linha de UI. */
export const MAX_CATEGORY_LENGTH = 64;

// Zip payload guards (PRD §5.4 / Google baseline).
export const MAX_ZIP_ENTRIES = 10_000;
export const MAX_UNCOMPRESSED_TOTAL_BYTES = 500 * 1024 * 1024; // 500 MB
export const MAX_SINGLE_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_COMPRESSION_RATIO = 100; // 100:1 zip-bomb ceiling
export const MAX_FOLDER_DEPTH = 8;
