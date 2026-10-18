import type { ServiceDescriptionPart } from "@orchestration-ai/sdk/services";

type Params = ServiceDescriptionPart["parameters"];

/**
 * A single Notion tool entry.
 *
 * `method` is the dotted path to a method on the v5 `@notionhq/client` Client
 * instance (e.g. "dataSources.query", "blocks.children.append"). The generic
 * dispatcher in notion.service.ts resolves this path and forwards `body` as the
 * single arguments object the SDK expects.
 *
 * `parameters` drives the agent-facing ServiceDescription in
 * notion.description.ts. We intentionally keep nested Notion payloads (filters,
 * rich_text, block objects, property maps) as free-form `object` parameters:
 * fully typing Notion's recursive request schema in ServiceDescription form is
 * neither practical nor useful to an LLM caller, which already knows the Notion
 * JSON shapes.
 */
export type NotionToolEntry = {
  /** Tool path exposed to agents (also the key in the tools map). */
  tool: string;
  /** Dotted method path on the Notion v5 Client. */
  method: string;
  /** Human description surfaced to agents. */
  description: string;
  /** ServiceDescription parameters for this tool. */
  parameters: Params;
};

// ── Reusable parameter fragments ────────────────────────────────────────────

const freeObject = (description: string, optional = true) =>
  ({ type: "object" as const, optional, description, properties: {} });

const str = (description: string, optional = false) =>
  ({ type: "string" as const, optional, description });

const num = (description: string, optional = true) =>
  ({ type: "number" as const, optional, description });

const startCursor = str("Pagination cursor from a previous response's next_cursor.", true);
const pageSize = num("Number of results per page (max 100).");

const P = "Part of OAI Notion.";

/**
 * Tier 1 (core content API) + Tier 2 (views). Notion AI/agent-platform
 * namespaces (agents, sessions, asyncTasks, skills, plugins, meetingNotes) and
 * oauth are intentionally excluded. Raw fileUploads.* are replaced by the two
 * OAI-files bridge tools defined separately in notion.service.ts.
 */
export const NOTION_TOOL_TABLE: NotionToolEntry[] = [
  // ── Search ────────────────────────────────────────────────────────────────
  {
    tool: "search",
    method: "search",
    description: `${P} Search all pages and data sources shared with the integration by title.`,
    parameters: {
      query: str("Text to search page/data-source titles for. Omit to list everything shared.", true),
      filter: freeObject("Optional filter, e.g. { property: 'object', value: 'page' | 'data_source' }."),
      sort: freeObject("Optional sort, e.g. { timestamp: 'last_edited_time', direction: 'descending' }."),
      start_cursor: startCursor,
      page_size: pageSize,
    },
  },

  // ── Users ─────────────────────────────────────────────────────────────────
  {
    tool: "users_me",
    method: "users.me",
    description: `${P} Retrieve the bot user associated with the current integration token.`,
    parameters: {},
  },
  {
    tool: "users_retrieve",
    method: "users.retrieve",
    description: `${P} Retrieve a user by id.`,
    parameters: { user_id: str("The id of the user to retrieve.") },
  },
  {
    tool: "users_list",
    method: "users.list",
    description: `${P} List all users in the workspace.`,
    parameters: { start_cursor: startCursor, page_size: pageSize },
  },

  // ── Pages ─────────────────────────────────────────────────────────────────
  {
    tool: "pages_create",
    method: "pages.create",
    description: `${P} Create a page under a parent page, database, or data source. Properties must match the parent data source's schema.`,
    parameters: {
      parent: freeObject("Parent, e.g. { data_source_id } | { page_id } | { database_id }.", false),
      properties: freeObject("Page property values keyed by property name."),
      children: freeObject("Optional array of block objects for the page body (passed through as-is)."),
      icon: freeObject("Optional page icon."),
      cover: freeObject("Optional page cover."),
    },
  },
  {
    tool: "pages_retrieve",
    method: "pages.retrieve",
    description: `${P} Retrieve a page's properties by id.`,
    parameters: { page_id: str("The id of the page to retrieve.") },
  },
  {
    tool: "pages_update",
    method: "pages.update",
    description: `${P} Update a page's properties, icon, cover, or archive/trash state.`,
    parameters: {
      page_id: str("The id of the page to update."),
      properties: freeObject("Property values to update, keyed by property name."),
      icon: freeObject("Optional new icon."),
      cover: freeObject("Optional new cover."),
      archived: { type: "boolean", optional: true, description: "Set true to archive (move to trash)." },
      in_trash: { type: "boolean", optional: true, description: "Set true to move the page to trash." },
    },
  },
  {
    tool: "pages_move",
    method: "pages.move",
    description: `${P} Move a page to a new parent page or data source.`,
    parameters: {
      page_id: str("The id of the page to move."),
      parent: freeObject("New parent, e.g. { page_id } | { data_source_id }.", false),
    },
  },
  {
    tool: "pages_retrieve_markdown",
    method: "pages.retrieveMarkdown",
    description: `${P} Retrieve a page's content rendered as Markdown.`,
    parameters: { page_id: str("The id of the page to render as Markdown.") },
  },
  {
    tool: "pages_update_markdown",
    method: "pages.updateMarkdown",
    description: `${P} Replace or update a page's content using Markdown.`,
    parameters: {
      page_id: str("The id of the page to update."),
      markdown: str("The Markdown content to write to the page."),
    },
  },
  {
    tool: "pages_properties_retrieve",
    method: "pages.properties.retrieve",
    description: `${P} Retrieve a single page property item (paginated for large properties).`,
    parameters: {
      page_id: str("The id of the page."),
      property_id: str("The id of the property to retrieve."),
      start_cursor: startCursor,
      page_size: pageSize,
    },
  },

  // ── Blocks ────────────────────────────────────────────────────────────────
  {
    tool: "blocks_retrieve",
    method: "blocks.retrieve",
    description: `${P} Retrieve a block by id.`,
    parameters: { block_id: str("The id of the block to retrieve.") },
  },
  {
    tool: "blocks_update",
    method: "blocks.update",
    description: `${P} Update a block's content. Pass the block-type payload (e.g. { paragraph: {...} }).`,
    parameters: {
      block_id: str("The id of the block to update."),
      type: freeObject("Block-type payload to update, e.g. { paragraph: { rich_text: [...] } }. Spread at the top level of the request.", false),
    },
  },
  {
    tool: "blocks_delete",
    method: "blocks.delete",
    description: `${P} Delete (archive) a block by id.`,
    parameters: { block_id: str("The id of the block to delete.") },
  },
  {
    tool: "blocks_children_list",
    method: "blocks.children.list",
    description: `${P} List the child blocks of a page or block (the body content).`,
    parameters: {
      block_id: str("The id of the parent page or block."),
      start_cursor: startCursor,
      page_size: pageSize,
    },
  },
  {
    tool: "blocks_children_append",
    method: "blocks.children.append",
    description: `${P} Append child blocks (content) to a page or block.`,
    parameters: {
      block_id: str("The id of the parent page or block."),
      children: freeObject("Array of block objects to append.", false),
      after: str("Optional id of an existing child to insert after.", true),
    },
  },

  // ── Databases ─────────────────────────────────────────────────────────────
  {
    tool: "databases_create",
    method: "databases.create",
    description: `${P} Create a database (container of data sources) under a page or the workspace.`,
    parameters: {
      parent: freeObject("Parent, e.g. { type: 'page_id', page_id } | { type: 'workspace', workspace: true }.", false),
      title: freeObject("Optional array of rich text items for the title."),
      initial_data_source: freeObject("Optional initial data source definition (properties schema)."),
      is_inline: { type: "boolean", optional: true, description: "Whether the database renders inline." },
      icon: freeObject("Optional icon."),
      cover: freeObject("Optional cover."),
    },
  },
  {
    tool: "databases_retrieve",
    method: "databases.retrieve",
    description: `${P} Retrieve a database by id, including its list of data sources.`,
    parameters: { database_id: str("The id of the database to retrieve.") },
  },
  {
    tool: "databases_update",
    method: "databases.update",
    description: `${P} Update a database's title, description, inline flag, icon/cover, or trash state.`,
    parameters: {
      database_id: str("The id of the database to update."),
      title: freeObject("Optional array of rich text items for the title."),
      description: freeObject("Optional array of rich text items for the description."),
      is_inline: { type: "boolean", optional: true, description: "Whether the database renders inline." },
      icon: freeObject("Optional icon."),
      cover: freeObject("Optional cover."),
      in_trash: { type: "boolean", optional: true, description: "Set true to move the database to trash." },
    },
  },

  // ── Data sources (v5 replacement for database query) ───────────────────────
  {
    tool: "data_sources_create",
    method: "dataSources.create",
    description: `${P} Create a data source (schema) under a parent database.`,
    parameters: {
      parent: freeObject("Parent of the data source, e.g. { type: 'database_id', database_id }.", false),
      properties: freeObject("Property schema keyed by property name.", false),
      title: freeObject("Optional array of rich text items for the title."),
      icon: freeObject("Optional icon."),
    },
  },
  {
    tool: "data_sources_retrieve",
    method: "dataSources.retrieve",
    description: `${P} Retrieve a data source's schema by id.`,
    parameters: { data_source_id: str("The id of the data source to retrieve.") },
  },
  {
    tool: "data_sources_update",
    method: "dataSources.update",
    description: `${P} Update a data source's title, icon, properties schema, or parent.`,
    parameters: {
      data_source_id: str("The id of the data source to update."),
      title: freeObject("Optional array of rich text items for the title."),
      properties: freeObject("Optional property-schema changes keyed by property name."),
      icon: freeObject("Optional icon."),
    },
  },
  {
    tool: "data_sources_query",
    method: "dataSources.query",
    description: `${P} Query a data source for pages (rows), with optional filter and sorts. This is the v5 replacement for the old databases.query. Get a data_source_id from databases_retrieve.`,
    parameters: {
      data_source_id: str("The id of the data source to query."),
      filter: freeObject("Optional Notion filter object."),
      sorts: freeObject("Optional array of sort objects."),
      start_cursor: startCursor,
      page_size: pageSize,
    },
  },
  {
    tool: "data_sources_list_templates",
    method: "dataSources.listTemplates",
    description: `${P} List templates available for a data source.`,
    parameters: {
      data_source_id: str("The id of the data source."),
      name: str("Optional name filter.", true),
      start_cursor: startCursor,
      page_size: pageSize,
    },
  },

  // ── Comments ──────────────────────────────────────────────────────────────
  {
    tool: "comments_create",
    method: "comments.create",
    description: `${P} Create a comment on a page or in an existing discussion.`,
    parameters: {
      parent: freeObject("Parent for a new page comment, e.g. { page_id }. Omit when using discussion_id."),
      discussion_id: str("Existing discussion id to reply to. Omit when using parent.", true),
      rich_text: freeObject("Array of rich text items for the comment body. Provide this or markdown."),
      markdown: str("Markdown comment body. Provide this or rich_text.", true),
    },
  },
  {
    tool: "comments_list",
    method: "comments.list",
    description: `${P} List unresolved comments on a block or page.`,
    parameters: {
      block_id: str("The id of the block or page whose comments to list."),
      start_cursor: startCursor,
      page_size: pageSize,
    },
  },
  {
    tool: "comments_retrieve",
    method: "comments.retrieve",
    description: `${P} Retrieve a comment by id.`,
    parameters: { comment_id: str("The id of the comment to retrieve.") },
  },
  {
    tool: "comments_update",
    method: "comments.update",
    description: `${P} Update a comment's content.`,
    parameters: {
      comment_id: str("The id of the comment to update."),
      rich_text: freeObject("Array of rich text items for the new comment body."),
    },
  },
  {
    tool: "comments_delete",
    method: "comments.delete",
    description: `${P} Delete a comment by id.`,
    parameters: { comment_id: str("The id of the comment to delete.") },
  },

  // ── Custom emojis ─────────────────────────────────────────────────────────
  {
    tool: "custom_emojis_list",
    method: "customEmojis.list",
    description: `${P} List the workspace's custom emojis.`,
    parameters: { start_cursor: startCursor, page_size: pageSize },
  },

  // ── Tier 2: Views ─────────────────────────────────────────────────────────
  {
    tool: "views_create",
    method: "views.create",
    description: `${P} Create a view on a database or data source.`,
    parameters: {
      database_id: str("The id of the database to create the view on. Provide this or data_source_id.", true),
      data_source_id: str("The id of the data source to create the view on.", true),
      name: str("Name of the view.", true),
      type: str("View type, e.g. 'table'.", true),
      configuration: freeObject("View configuration object."),
    },
  },
  {
    tool: "views_retrieve",
    method: "views.retrieve",
    description: `${P} Retrieve a view by id.`,
    parameters: { view_id: str("The id of the view to retrieve.") },
  },
  {
    tool: "views_update",
    method: "views.update",
    description: `${P} Update a view's name or configuration.`,
    parameters: {
      view_id: str("The id of the view to update."),
      name: str("Optional new name.", true),
      configuration: freeObject("Optional new configuration object."),
    },
  },
  {
    tool: "views_delete",
    method: "views.delete",
    description: `${P} Delete a view by id.`,
    parameters: { view_id: str("The id of the view to delete.") },
  },
  {
    tool: "views_list",
    method: "views.list",
    description: `${P} List views for a database or data source.`,
    parameters: {
      database_id: str("The id of the database whose views to list. Provide this or data_source_id.", true),
      data_source_id: str("The id of the data source whose views to list.", true),
      start_cursor: startCursor,
      page_size: pageSize,
    },
  },
];
