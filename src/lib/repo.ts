import type {
  Brief,
  Group,
  GroupPublication,
  MediaItem,
  Platform,
  Post,
  Project,
  Prompt,
  Tag,
  TaskTemplate,
} from "@/types";
import type { DataApi, Row } from "./store";

export interface Workspace {
  projects: Project[];
  platforms: Platform[];
  project: Project | null;
  brief: Brief | null;
  groups: Group[];
  posts: Post[];
  media: MediaItem[];
  prompts: Prompt[];
  templates: TaskTemplate[];
  tags: Tag[];
  publications: GroupPublication[];
}

const LINK_TABLES = [
  "post_tags",
  "post_media",
  "media_tags",
  "prompt_tags",
  "group_tags",
] as const;

/** Loads everything the UI needs into memory (the dataset is small and local). */
export async function loadWorkspace(
  api: DataApi,
  projectId: number | null,
): Promise<Workspace> {
  const [
    projects,
    platforms,
    briefs,
    groups,
    posts,
    media,
    prompts,
    templates,
    tags,
    postTags,
    postMedia,
    mediaTags,
    promptTags,
    groupTags,
    publications,
  ] = await Promise.all([
    api.all<Project>("projects"),
    api.all<Platform>("platforms"),
    api.all<Brief>("project_briefs"),
    api.all<Group>("groups"),
    api.all<Post>("posts"),
    api.all<MediaItem>("media"),
    api.all<Prompt>("prompts"),
    api.all<TaskTemplate>("task_templates"),
    api.all<Tag>("tags"),
    api.all<Row>("post_tags"),
    api.all<Row>("post_media"),
    api.all<Row>("media_tags"),
    api.all<Row>("prompt_tags"),
    api.all<Row>("group_tags"),
    api.all<GroupPublication>("group_publications"),
  ]);

  const tagName = (id: unknown) => tags.find((tag) => tag.id === Number(id))?.name ?? "";
  const namesFor = (rows: Row[], owner: string, ownerId: number) =>
    rows
      .filter((row) => Number(row[owner]) === ownerId)
      .map((row) => tagName(row.tag_id))
      .filter(Boolean);

  const project = projects.find((item) => item.id === projectId) ?? projects[0] ?? null;

  const workspace: Workspace = {
    projects,
    platforms: platforms.sort((a, b) => a.sort_order - b.sort_order),
    project,
    brief: briefs.find((item) => item.project_id === project?.id) ?? null,
    groups: groups
      .filter((group) => (project ? group.project_id === project.id : true))
      .map((group) => ({
        ...group,
        tags: namesFor(groupTags, "group_id", group.id),
      }))
      .sort((a, b) => b.pinned - a.pinned || a.name.localeCompare(b.name, "pl")),
    posts: posts
      .filter((post) => (project ? post.project_id === project.id : true))
      .map((post) => ({
        ...post,
        tags: namesFor(postTags, "post_id", post.id),
        media_ids: postMedia
          .filter((row) => Number(row.post_id) === post.id)
          .map((row) => Number(row.media_id)),
      }))
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)),
    media: media
      .filter((item) => (project ? item.project_id === project.id || item.project_id === null : true))
      .map((item) => ({
        ...item,
        tags: namesFor(mediaTags, "media_id", item.id),
      }))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    prompts: prompts
      .filter((prompt) =>
        project ? prompt.project_id === project.id || prompt.project_id === null : true,
      )
      .map((prompt) => ({
        ...prompt,
        tags: namesFor(promptTags, "prompt_id", prompt.id),
      }))
      .sort((a, b) => b.favorite - a.favorite || (a.created_at < b.created_at ? 1 : -1)),
    templates: templates
      .filter((template) => (project ? template.project_id === project.id || template.project_id === null : true))
      .sort((a, b) => a.sort_order - b.sort_order),
    tags,
    publications: publications.sort((a, b) => (a.published_at < b.published_at ? 1 : -1)),
  };

  return workspace;
}

/* ------------------------------------------------------------------ */
/* Tags                                                                */
/* ------------------------------------------------------------------ */

export async function resolveTagIds(api: DataApi, names: string[]): Promise<number[]> {
  const tags = await api.all<Tag>("tags");
  const ids: number[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    let tag = tags.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (!tag) {
      tag = await api.insert<Tag>("tags", { name });
      tags.push(tag);
    }
    if (!ids.includes(tag.id)) ids.push(tag.id);
  }
  return ids;
}

export async function setTags(
  api: DataApi,
  table: (typeof LINK_TABLES)[number],
  ownerColumn: string,
  ownerId: number,
  names: string[],
): Promise<void> {
  const ids = await resolveTagIds(api, names);
  await api.setLinks(table, ownerColumn, ownerId, "tag_id", ids);
}

/* ------------------------------------------------------------------ */
/* Brief                                                               */
/* ------------------------------------------------------------------ */

export async function saveBrief(api: DataApi, brief: Brief): Promise<Brief> {
  const payload = { ...brief, updated_at: new Date().toISOString() };
  const existing = await api.all<Brief>("project_briefs");
  const found = existing.find((item) => item.project_id === brief.project_id);
  if (found) {
    return api.update<Brief>("project_briefs", found.project_id, payload);
  }
  return api.insert<Brief>("project_briefs", payload);
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

export async function createProject(
  api: DataApi,
  data: { name: string; platform: string; url: string; color: string },
): Promise<Project> {
  const project = await api.insert<Project>("projects", {
    ...data,
    icon: null,
    created_at: new Date().toISOString(),
  });
  await api.insert("project_briefs", {
    project_id: project.id,
    about: "",
    audience: "",
    tone: "",
    avoid: "",
    rules: "",
    fixed_elements: "",
    extra_context: "",
    visual_guidelines: "",
    updated_at: new Date().toISOString(),
  });
  return project;
}

export async function updateProject(
  api: DataApi,
  id: number,
  patch: Partial<Project>,
): Promise<Project> {
  return api.update<Project>("projects", id, patch);
}

export async function deleteProject(api: DataApi, id: number): Promise<void> {
  const groups = await api.all<Group>("groups");
  for (const group of groups.filter((item) => item.project_id === id)) {
    await api.remove("groups", group.id);
  }
  const posts = await api.all<Post>("posts");
  for (const post of posts.filter((item) => item.project_id === id)) {
    await api.remove("posts", post.id);
  }
  const media = await api.all<MediaItem>("media");
  for (const item of media.filter((entry) => entry.project_id === id)) {
    await api.remove("media", item.id);
  }
  await api.remove("project_briefs", id);
  await api.remove("projects", id);
}

/* ------------------------------------------------------------------ */
/* Groups                                                              */
/* ------------------------------------------------------------------ */

export interface GroupInput {
  project_id: number;
  name: string;
  url: string | null;
  topic: string | null;
  members: number | null;
  rules: string | null;
  notes: string | null;
  pinned: number;
}

export async function createGroup(api: DataApi, data: GroupInput): Promise<Group> {
  return api.insert<Group>("groups", { ...data, created_at: new Date().toISOString() });
}

export async function updateGroup(
  api: DataApi,
  id: number,
  patch: Partial<GroupInput>,
): Promise<Group> {
  return api.update<Group>("groups", id, patch);
}

export async function deleteGroup(api: DataApi, id: number): Promise<void> {
  const publications = await api.all<GroupPublication>("group_publications");
  for (const publication of publications.filter((item) => item.group_id === id)) {
    await api.remove("group_publications", publication.id);
  }
  const posts = await api.all<Post>("posts");
  for (const post of posts.filter((item) => item.group_id === id)) {
    await api.update("posts", post.id, { group_id: null });
  }
  await api.remove("groups", id);
}

/** Creates groups from a pasted list of URLs (one per line). */
export async function bulkCreateGroups(
  api: DataApi,
  projectId: number,
  lines: string[],
): Promise<{ created: number; skipped: number }> {
  const existing = await api.all<Group>("groups");
  const known = new Set(existing.map((group) => (group.url ?? "").toLowerCase()));
  let created = 0;
  let skipped = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const isUrl = /^https?:\/\//i.test(line);
    const url = isUrl ? line : `https://www.facebook.com/groups/${line.replace(/\s+/g, "-")}`;
    if (known.has(url.toLowerCase())) {
      skipped += 1;
      continue;
    }
    known.add(url.toLowerCase());
    const name = isUrl
      ? url
          .split("/groups/")[1]
          ?.split(/[/?#]/)[0]
          ?.replace(/-/g, " ")
          .replace(/\b\w/g, (character) => character.toUpperCase()) || url
      : line;
    await createGroup(api, {
      project_id: projectId,
      name,
      url,
      topic: null,
      members: null,
      rules: null,
      notes: null,
      pinned: 0,
    });
    created += 1;
  }

  return { created, skipped };
}

/* ------------------------------------------------------------------ */
/* Posts                                                               */
/* ------------------------------------------------------------------ */

export interface PostInput {
  project_id: number;
  title: string;
  body: string;
  kind: Post["kind"];
  status: Post["status"];
  group_id: number | null;
  notes: string | null;
}

export async function createPost(api: DataApi, data: PostInput): Promise<Post> {
  const now = new Date().toISOString();
  const post = await api.insert<Post>("posts", {
    ...data,
    published_at: null,
    published_url: null,
    created_at: now,
    updated_at: now,
  });
  return post;
}

export async function updatePost(
  api: DataApi,
  id: number,
  patch: Partial<PostInput> & { published_at?: string | null; published_url?: string | null },
): Promise<Post> {
  return api.update<Post>("posts", id, { ...patch, updated_at: new Date().toISOString() });
}

export async function deletePost(api: DataApi, id: number): Promise<void> {
  await api.setLinks("post_media", "post_id", id, "media_id", []);
  await api.setLinks("post_tags", "post_id", id, "tag_id", []);
  await api.remove("posts", id);
}

export async function duplicatePost(api: DataApi, post: Post): Promise<Post> {
  const copy = await createPost(api, {
    project_id: post.project_id,
    title: `${post.title} (kopia)`,
    body: post.body,
    kind: post.kind,
    status: "idea",
    group_id: null,
    notes: post.notes,
  });
  await setTags(api, "post_tags", "post_id", copy.id, post.tags);
  await api.setLinks("post_media", "post_id", copy.id, "media_id", post.media_ids);
  return copy;
}

export interface PublishInput {
  groupId: number | null;
  publishedAt: string;
  publishedUrl: string | null;
  outcomeNote: string | null;
}

/** Marks a post as published and records it in the group history. */
export async function publishPost(
  api: DataApi,
  post: Post,
  input: PublishInput,
): Promise<Post> {
  const updated = await updatePost(api, post.id, {
    status: "published",
    group_id: post.kind === "group" ? input.groupId : null,
    published_at: input.publishedAt,
    published_url: input.publishedUrl,
  });

  if (post.kind === "group" && input.groupId) {
    await api.insert("group_publications", {
      group_id: input.groupId,
      post_id: post.id,
      body_snapshot: post.body,
      published_at: input.publishedAt,
      post_url: input.publishedUrl,
      outcome_note: input.outcomeNote,
    });
  }

  return updated;
}

/* ------------------------------------------------------------------ */
/* Media                                                               */
/* ------------------------------------------------------------------ */

export async function updateMedia(
  api: DataApi,
  id: number,
  patch: Partial<MediaItem>,
): Promise<MediaItem> {
  return api.update<MediaItem>("media", id, patch);
}

export async function deleteMedia(api: DataApi, id: number): Promise<void> {
  await api.setLinks("media_tags", "media_id", id, "tag_id", []);
  await api.remove("media", id);
}

/* ------------------------------------------------------------------ */
/* Prompts                                                             */
/* ------------------------------------------------------------------ */

export interface PromptInput {
  project_id: number | null;
  title: string;
  kind: Prompt["kind"];
  body: string;
  favorite: number;
  notes: string | null;
}

export async function createPrompt(api: DataApi, data: PromptInput): Promise<Prompt> {
  return api.insert<Prompt>("prompts", { ...data, created_at: new Date().toISOString() });
}

export async function updatePrompt(
  api: DataApi,
  id: number,
  patch: Partial<PromptInput>,
): Promise<Prompt> {
  return api.update<Prompt>("prompts", id, patch);
}

export async function deletePrompt(api: DataApi, id: number): Promise<void> {
  await api.setLinks("prompt_tags", "prompt_id", id, "tag_id", []);
  await api.remove("prompts", id);
}

export async function duplicatePrompt(api: DataApi, prompt: Prompt): Promise<Prompt> {
  const copy = await createPrompt(api, {
    project_id: prompt.project_id,
    title: `${prompt.title} (kopia)`,
    kind: prompt.kind,
    body: prompt.body,
    favorite: 0,
    notes: prompt.notes,
  });
  await setTags(api, "prompt_tags", "prompt_id", copy.id, prompt.tags);
  return copy;
}

/* ------------------------------------------------------------------ */
/* Task templates                                                      */
/* ------------------------------------------------------------------ */

export interface TemplateInput {
  project_id: number | null;
  title: string;
  kind: TaskTemplate["kind"];
  instruction: string;
  sort_order: number;
}

export async function createTemplate(
  api: DataApi,
  data: TemplateInput,
): Promise<TaskTemplate> {
  return api.insert<TaskTemplate>("task_templates", {
    ...data,
    created_at: new Date().toISOString(),
  });
}

export async function updateTemplate(
  api: DataApi,
  id: number,
  patch: Partial<TemplateInput>,
): Promise<TaskTemplate> {
  return api.update<TaskTemplate>("task_templates", id, patch);
}

export async function deleteTemplate(api: DataApi, id: number): Promise<void> {
  await api.remove("task_templates", id);
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export async function getSetting(api: DataApi, key: string): Promise<string | null> {
  const rows = await api.all<Row>("settings");
  const found = rows.find((row) => row.key === key);
  return found ? String(found.value) : null;
}

export async function setSetting(api: DataApi, key: string, value: string): Promise<void> {
  // Desktop backend exposes an atomic upsert; the browser fallback keeps the
  // read-modify-write over rows.
  if (api.setSetting) {
    await api.setSetting(key, value);
    return;
  }
  const rows = await api.all<Row>("settings");
  const found = rows.find((row) => row.key === key);
  if (found) {
    await api.update("settings", Number(found.id), { value });
  } else {
    await api.insert("settings", { key, value });
  }
}
