// Capture size is independent of one wire message. Raw editable properties cost substantially
// more than codegen context (a live 15,911-node page exceeded the original six-million cap).
export const DEFAULT_BACKUP_CAPTURE_CHARS = 128_000_000;
export const MAX_BACKUP_CAPTURE_CHARS = 256_000_000;
export const MAX_BACKUP_NODE_COUNT = 50_000;
export const MAX_BACKUP_ARCHIVE_BYTES = 256 * 1024 * 1024;
