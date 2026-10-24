/**
 * Shared domain model for SocialHQ.
 * The database stores rows as plain objects; these interfaces describe them.
 */

export type PlatformId = string;

export interface Platform {
  id: PlatformId;
  label: string;
  color: string;
  sort_order: number;
}

export interface Project {
  id: number;
  name: string;
  platform: PlatformId;
  url: string | null;
  color: string;
  icon: string | null;
  created_at: string;
}

export interface Brief {
  project_id: number;
  about: string;
  audience: string;
  tone: string;
  avoid: string;
  rules: string;
  fixed_elements: string;
  extra_context: string;
  visual_guidelines: string;
  updated_at: string;
}

export type TaskKind = "text" | "image" | "ideas";

export interface TaskTemplate {
  id: number;
  project_id: number | null;
  title: string;
  kind: TaskKind;
  instruction: string;
  sort_order: number;
  created_at: string;
}

export type PostKind = "page" | "group";
export type PostStatus = "idea" | "draft" | "ready" | "published";

export interface Post {
  id: number;
  project_id: number;
  title: string;
  body: string;
  kind: PostKind;
  status: PostStatus;
  group_id: number | null;
  notes: string | null;
  published_at: string | null;
  published_url: string | null;
  created_at: string;
  updated_at: string;
  tags: string[];
  media_ids: number[];
}

export interface Group {
  id: number;
  project_id: number;
  name: string;
  url: string | null;
  topic: string | null;
  members: number | null;
  rules: string | null;
  notes: string | null;
  pinned: number;
  created_at: string;
  tags?: string[];
}

export interface GroupPublication {
  id: number;
  group_id: number;
  post_id: number | null;
  body_snapshot: string;
  published_at: string;
  post_url: string | null;
  outcome_note: string | null;
}

export interface MediaItem {
  id: number;
  project_id: number | null;
  category: string;
  file_name: string;
  file_path: string;
  thumb_path: string;
  sha256: string;
  width: number;
  height: number;
  size_bytes: number;
  description: string;
  created_at: string;
  tags: string[];
}

export interface Prompt {
  id: number;
  project_id: number | null;
  title: string;
  kind: "text" | "image";
  body: string;
  favorite: number;
  notes: string | null;
  created_at: string;
  tags: string[];
}

export interface Tag {
  id: number;
  name: string;
}

export interface SearchHit {
  entity_type: "post" | "group" | "prompt" | "media";
  entity_id: number;
  title: string;
  snippet: string;
}

export interface BackupEntry {
  name: string;
  path: string;
  size: number;
  created_at: string;
}

export interface DataPaths {
  root: string;
  database: string;
  media: string;
  backups: string;
  exports: string;
  backend: "tauri" | "browser";
}

export const POST_STATUSES: { id: PostStatus; label: string }[] = [
  { id: "idea", label: "Pomysł" },
  { id: "draft", label: "Szkic" },
  { id: "ready", label: "Gotowy" },
  { id: "published", label: "Opublikowany" },
];

export const POST_KINDS: { id: PostKind; label: string }[] = [
  { id: "page", label: "Post na stronę" },
  { id: "group", label: "Post do grupy" },
];

export const DEFAULT_MEDIA_CATEGORIES = [
  "profilowe",
  "tlo",
  "do-postow",
  "logo",
  "inne",
];
